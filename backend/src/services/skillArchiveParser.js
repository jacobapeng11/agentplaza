const crypto = require('crypto');
const path = require('path');
const yauzl = require('yauzl');
const yazl = require('yazl');
const yaml = require('js-yaml');

function configuredLimit(name, ceiling) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : ceiling;
}

const MAX_ARCHIVE_BYTES = configuredLimit('SKILL_MAX_ARCHIVE_BYTES', 50 * 1024 * 1024);
const MAX_EXPANDED_BYTES = configuredLimit('SKILL_MAX_EXPANDED_BYTES', 200 * 1024 * 1024);
const MAX_FILES = configuredLimit('SKILL_MAX_FILES', 10000);
const MAX_SKILL_MD_BYTES = configuredLimit('SKILL_MAX_SKILL_MD_BYTES', 1024 * 1024);
const MAX_PATH_DEPTH = configuredLimit('SKILL_MAX_PATH_DEPTH', 20);
const MAX_SKILLS_PER_ARCHIVE = 20;
const MAX_JOB_METADATA_BYTES = 8 * 1024 * 1024;

class SkillArchiveError extends Error {
  constructor(message, code = 'INVALID_SKILL_ARCHIVE') {
    super(message);
    this.name = 'SkillArchiveError';
    this.code = code;
    this.statusCode = 400;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeArchivePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/').filter(Boolean);
  if (!normalized || normalized.length > 512 || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)
      || segments.includes('..') || segments.includes('.') || normalized.includes('//') || /[\u0000-\u001f]/.test(normalized)) {
    throw new SkillArchiveError(`压缩包包含不安全路径: ${value}`, 'UNSAFE_ARCHIVE_PATH');
  }
  if (segments.length > MAX_PATH_DEPTH) {
    throw new SkillArchiveError(`文件路径层级超过 ${MAX_PATH_DEPTH} 层: ${value}`, 'ARCHIVE_PATH_TOO_DEEP');
  }
  return normalized;
}

function isSymbolicLink(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function openZip(source) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(source, { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(new SkillArchiveError(`ZIP 文件无法读取: ${error.message}`));
      else resolve(zip);
    });
  });
}

function readEntryBuffer(zip, entry, maxBytes = MAX_EXPANDED_BYTES) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy(new SkillArchiveError(`压缩包内文件超过允许大小: ${entry.fileName}`, 'ARCHIVE_ENTRY_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

function createZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks = [];
    archive.outputStream.on('data', (chunk) => chunks.push(chunk));
    archive.outputStream.once('error', reject);
    archive.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    for (const file of files) {
      archive.addBuffer(file.buffer, file.path, { mtime: new Date('1980-01-01T00:00:00.000Z'), mode: 0o100644 });
    }
    archive.end();
  });
}

function splitFrontmatter(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: source };

  let metadata = {};
  try {
    metadata = yaml.safeLoad(match[1]) || {};
  } catch (error) {
    throw new SkillArchiveError(`SKILL.md YAML frontmatter 无法解析: ${error.message}`, 'INVALID_SKILL_FRONTMATTER');
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
  return { metadata, body: source.slice(match[0].length) };
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function firstMarkdownHeading(body) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function firstParagraph(body) {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s+.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim())
    .find((block) => block && !block.startsWith('![') && !block.startsWith('|'))
    ?.replace(/\s+/g, ' ')
    .slice(0, 500) || '';
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',') : []);
  return [...new Set(list.filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 80)).filter(Boolean))].slice(0, 10);
}

function normalizeManifest(metadata) {
  const fields = ['name', 'description', 'summary', 'id', 'skillId', 'skill_id', 'version', 'category', 'license'];
  const result = {};
  for (const field of fields) {
    const value = metadata[field];
    if (typeof value === 'string' || typeof value === 'number') result[field] = String(value).slice(0, 1000);
  }
  result.tags = normalizeTags(metadata.tags);
  return result;
}

function buildParseItem(candidate, files) {
  const { metadata: documentFields, body } = splitFrontmatter(candidate.content);
  const metadata = normalizeManifest(documentFields);
  const sourcePath = candidate.path;
  const rootPath = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
  const fallbackName = path.posix.basename(rootPath.replace(/\/$/, '')) || '未命名 Skill';
  const name = String(metadata.name || firstMarkdownHeading(body) || fallbackName).trim().slice(0, 120);
  const summary = String(metadata.description || metadata.summary || firstParagraph(body)).trim().slice(0, 1000);
  const manifestId = metadata.id || metadata.skillId || metadata.skill_id || null;
  const version = String(metadata.version || '').trim().slice(0, 100);
  const skillFiles = files.filter((file) => !rootPath || file.path.startsWith(rootPath));
  const fileManifest = skillFiles.map((file) => ({
    path: file.path.slice(rootPath.length),
    size: file.size,
    compressedSize: file.compressedSize
  }));
  const semanticBody = normalizeText(body);
  const structuralSignature = fileManifest
    .sort((left, right) => left.path.localeCompare(right.path));
  const contentFingerprint = sha256(`${semanticBody || normalizeText(candidate.content)}\n${JSON.stringify(structuralSignature)}`);

  return {
    itemKey: sha256(sourcePath).slice(0, 20),
    sourcePath,
    rootPath,
    name,
    summary,
    manifestId: manifestId ? String(manifestId).trim().slice(0, 200) : null,
    version,
    category: String(metadata.category || '').trim(),
    tags: normalizeTags(metadata.tags),
    license: String(metadata.license || '').trim().slice(0, 120),
    contentFingerprint,
    skillMdContent: candidate.content,
    fileCount: skillFiles.length,
    expandedSize: skillFiles.reduce((total, file) => total + file.size, 0),
    fileManifest,
    parsedMetadata: metadata,
    warnings: summary ? [] : ['未识别到简介，建议发布前补充'],
    _artifactFiles: skillFiles.map((file) => ({ path: file.path.slice(rootPath.length), buffer: file.buffer }))
  };
}

function isSkillMarkdown(entryPath) {
  const lower = entryPath.toLowerCase();
  return lower === 'skill.md' || lower.endsWith('/skill.md');
}

async function readSkillZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SkillArchiveError('Skill ZIP 内容为空');
  }
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    throw new SkillArchiveError(`Skill ZIP 不能超过 ${Math.floor(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB`, 'ARCHIVE_TOO_LARGE');
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new SkillArchiveError('文件不是有效的 ZIP 压缩包');
  }

  const zip = await openZip(buffer);
  try {
    if (zip.entryCount > MAX_FILES * 2) {
      throw new SkillArchiveError('压缩包条目过多', 'ARCHIVE_TOO_MANY_FILES');
    }
    return await readZipEntries(zip);
  } finally {
    zip.close();
  }
}

function readZipEntries(zip) {
  const files = [];
  const archivePaths = new Set();
  let expandedSize = 0;
  let skippedSymlinkCount = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      try { zip.close(); } catch {}
      reject(error instanceof SkillArchiveError ? error : new SkillArchiveError(error.message));
    };

    zip.once('error', finishError);
    zip.once('end', () => {
      if (settled) return;
      settled = true;
      resolve({ files, expandedSize, skippedSymlinkCount });
    });

    zip.on('entry', async (entry) => {
      try {
        const entryPath = normalizeArchivePath(entry.fileName);
        // The parser never extracts files. Ignore symlinks when creating the distributable ZIP.
        if (isSymbolicLink(entry)) {
          skippedSymlinkCount += 1;
          zip.readEntry();
          return;
        }
        if (/\/$/.test(entryPath)) {
          zip.readEntry();
          return;
        }
        const key = entryPath.normalize('NFC').toLowerCase();
        if (archivePaths.has(key)) throw new SkillArchiveError('压缩包包含重复的文件路径', 'DUPLICATE_ARCHIVE_PATH');
        archivePaths.add(key);
        if (files.length >= MAX_FILES) throw new SkillArchiveError(`压缩包文件数不能超过 ${MAX_FILES}`, 'ARCHIVE_TOO_MANY_FILES');
        expandedSize += Number(entry.uncompressedSize || 0);
        if (expandedSize > MAX_EXPANDED_BYTES) {
          throw new SkillArchiveError(`解压后总大小不能超过 ${Math.floor(MAX_EXPANDED_BYTES / 1024 / 1024)} MB`, 'ARCHIVE_EXPANDED_TOO_LARGE');
        }
        const file = { path: entryPath, size: entry.uncompressedSize, compressedSize: entry.compressedSize };
        file.buffer = await readEntryBuffer(zip, entry, isSkillMarkdown(entryPath) ? MAX_SKILL_MD_BYTES : MAX_EXPANDED_BYTES);
        files.push(file);
        zip.readEntry();
      } catch (error) {
        finishError(error);
      }
    });

    zip.readEntry();
  });
}

function selectSkillCandidates(files) {
  const candidates = files.filter((file) => isSkillMarkdown(file.path));
  if (!candidates.length) throw new SkillArchiveError('压缩包中没有找到 SKILL.md', 'SKILL_MD_NOT_FOUND');
  if (candidates.length > MAX_SKILLS_PER_ARCHIVE) {
    throw new SkillArchiveError('单个 ZIP 最多包含 20 个 Skill', 'ARCHIVE_TOO_MANY_SKILLS');
  }
  const roots = candidates.map(candidate => candidate.path.slice(0, candidate.path.lastIndexOf('/') + 1).toLowerCase()).sort();
  if (roots.some((root, index) => index > 0 && root.startsWith(roots[index - 1]))) {
    throw new SkillArchiveError('每个 Skill 必须位于独立目录中', 'OVERLAPPING_SKILL_ROOTS');
  }
  return candidates;
}

async function parseSkillArchive(buffer) {
  const { files, expandedSize, skippedSymlinkCount } = await readSkillZip(buffer);
  const selectedCandidates = selectSkillCandidates(files);
  const builtItems = selectedCandidates.map((file) => buildParseItem({ path: file.path, content: file.buffer.toString('utf8') }, files));
  if (skippedSymlinkCount > 0) {
    const warning = `压缩包包含 ${skippedSymlinkCount} 个符号链接，已安全忽略`;
    builtItems.forEach((item) => item.warnings.push(warning));
  }
  const items = builtItems.map(({ _artifactFiles, ...item }) => item);
  if (Buffer.byteLength(JSON.stringify(items)) > MAX_JOB_METADATA_BYTES) {
    throw new SkillArchiveError('Skill 清单超过允许大小', 'ARCHIVE_METADATA_TOO_LARGE');
  }
  const artifacts = await Promise.all(builtItems.map(async (item) => {
    const artifactBuffer = await createZipBuffer(item._artifactFiles);
    return { itemKey: item.itemKey, buffer: artifactBuffer, size: artifactBuffer.length, sha256: sha256(artifactBuffer) };
  }));
  return { archiveHash: sha256(buffer), archiveSize: buffer.length, expandedSize, fileCount: files.length, items, artifacts };
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_EXPANDED_BYTES,
  MAX_SKILL_MD_BYTES,
  SkillArchiveError,
  buildParseItem,
  createZipBuffer,
  normalizeArchivePath,
  normalizeTags,
  parseSkillArchive,
  readEntryBuffer,
  readSkillZip,
  selectSkillCandidates,
  splitFrontmatter
};
