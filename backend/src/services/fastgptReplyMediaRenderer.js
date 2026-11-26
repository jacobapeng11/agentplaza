const { containsCredentialText } = require('../utils/credentialText');

const FASTGPT_SYSTEM_FILE_PATH = '/api/system/file/';
const TRAILING_URL_PUNCTUATION = /[.,，。!！?？;；:：\]}]+$/u;

// 作用: 判断当前位置是否被奇数个反斜杠转义；输入为文本和字符下标；输出为布尔值。
function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

// 作用: 用空格遮蔽指定区间但保留换行和总长度；输入为字符数组与起止位置；输出为原数组原地更新。
function maskRange(chars, start, end) {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== '\n' && chars[index] !== '\r') {
      chars[index] = ' ';
    }
  }
}

// 作用: 遮蔽 fenced code、行内代码和 HTML 标签；输入为原始 Markdown；输出为与原文等长的扫描文本。
function maskProtectedMarkdown(markdown) {
  const chars = String(markdown || '').split('');
  const source = chars.join('');
  const fencePattern = /^( {0,3})(`{3,}|~{3,}).*$/gm;
  let fence = fencePattern.exec(source);
  while (fence) {
    const marker = fence[2][0];
    const markerLength = fence[2].length;
    const closePattern = new RegExp(`^ {0,3}${marker}{${markerLength},}\\s*$`, 'gm');
    closePattern.lastIndex = fencePattern.lastIndex;
    const close = closePattern.exec(source);
    const end = close ? closePattern.lastIndex : source.length;
    maskRange(chars, fence.index, end);
    fencePattern.lastIndex = end;
    fence = fencePattern.exec(source);
  }

  let cursor = 0;
  while (cursor < chars.length) {
    if (chars[cursor] === '`' && !isEscaped(source, cursor)) {
      let runEnd = cursor;
      while (chars[runEnd] === '`') runEnd += 1;
      const markerLength = runEnd - cursor;
      let close = runEnd;
      while (close < chars.length) {
        if (chars[close] !== '`') {
          close += 1;
          continue;
        }
        let closeRunEnd = close;
        while (chars[closeRunEnd] === '`') closeRunEnd += 1;
        if (closeRunEnd - close === markerLength) break;
        close = closeRunEnd;
      }
      if (close < chars.length) {
        maskRange(chars, cursor, close + markerLength);
        cursor = close + markerLength;
        continue;
      }
    }
    const escapedImage = chars[cursor] === '!' && chars[cursor + 1] === '[' && isEscaped(source, cursor);
    const escapedLink = chars[cursor] === '[' && isEscaped(source, cursor);
    if (escapedImage || escapedLink) {
      const bracketStart = escapedImage ? cursor + 1 : cursor;
      const bracketEnd = findClosingDelimiter(source, bracketStart + 1, '[', ']');
      let openParen = bracketEnd + 1;
      while (/\s/.test(source[openParen] || '')) openParen += 1;
      const destination = bracketEnd >= 0 && source[openParen] === '('
        ? readMarkdownDestination(source, openParen)
        : null;
      if (destination) {
        maskRange(chars, cursor, destination.end);
        cursor = destination.end;
        continue;
      }
    }
    if (chars[cursor] === '<') {
      const autolink = source.slice(cursor).match(/^<https?:\/\/[^\s<>]+>/i);
      if (autolink) {
        if (isEscaped(source, cursor)) {
          maskRange(chars, cursor, cursor + autolink[0].length);
        }
        cursor += autolink[0].length;
        continue;
      }
      if (isEscaped(source, cursor)) {
        cursor += 1;
        continue;
      }
      let close = cursor + 1;
      let quote = '';
      while (close < source.length) {
        const char = source[close];
        if ((char === '"' || char === "'") && !isEscaped(source, close)) {
          quote = quote === char ? '' : (quote || char);
        } else if (char === '>' && !quote) {
          break;
        }
        close += 1;
      }
      if (close < source.length) {
        maskRange(chars, cursor, close + 1);
        cursor = close + 1;
        continue;
      }
    }
    cursor += 1;
  }
  return chars.join('');
}

// 作用: 额外遮蔽普通 Markdown 链接/图片，避免其 label/destination 定界符影响后续裸 URL；输入为原文；输出为等长遮蔽文本。
function maskMarkdownDelimiterProtectedRanges(markdown) {
  const source = String(markdown || '');
  const chars = maskProtectedMarkdown(source).split('');
  const masked = chars.join('');
  for (let cursor = 0; cursor < masked.length; cursor += 1) {
    const imageMarker = masked[cursor] === '!' && masked[cursor + 1] === '[';
    const linkMarker = masked[cursor] === '[';
    if ((!imageMarker && !linkMarker) || isEscaped(source, cursor)) continue;
    const bracketStart = imageMarker ? cursor + 1 : cursor;
    const bracketEnd = findClosingDelimiter(masked, bracketStart + 1, '[', ']');
    let openParen = bracketEnd + 1;
    while (bracketEnd >= 0 && /\s/.test(masked[openParen] || '')) openParen += 1;
    const destination = bracketEnd >= 0 && masked[openParen] === '('
      ? readMarkdownDestination(masked, openParen)
      : null;
    if (!destination) continue;
    maskRange(chars, cursor, destination.end);
    cursor = destination.end - 1;
  }
  return chars.join('');
}

// 作用: 读取 HTTP(S) URL 的可信扩展名；输入为 URL；输出为不带点的小写扩展名。
function getUrlExtension(url) {
  try {
    const match = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

// 作用: 按显式类型、扩展名和 FastGPT 文件路径分类；输入为 URL 与扩展名集合；输出为 image/file/unknown 或空字符串。
function classifyMediaUrl(url, { forceType = '', imageExtensions, fileExtensions }) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (error) {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  if (forceType === 'image' || forceType === 'file') return forceType;
  const extension = getUrlExtension(parsed.toString());
  if (imageExtensions.has(extension)) return 'image';
  if (fileExtensions.has(extension)) return 'file';
  return parsed.pathname.toLowerCase().includes(FASTGPT_SYSTEM_FILE_PATH) ? 'unknown' : '';
}

// 作用: 判断字符是否属于 Markdown 空白边界；输入为单个字符或空值；输出为边界/空白时返回 true。
function isMarkdownWhitespace(char) {
  return !char || /\s/u.test(char);
}

// 作用: 判断字符是否属于 Markdown 标点/符号边界；输入为单个字符；输出为 Unicode 标点或符号时返回 true。
function isMarkdownPunctuation(char) {
  return Boolean(char) && /[\p{P}\p{S}]/u.test(char);
}

// 作用: 按 CommonMark 左右 flanking 规则分类完整 delimiter run；输入为原文、run 起点/长度和 marker 字符；输出为可开启/可闭合状态。
function classifyMarkdownDelimiterRun(text, index, length, marker) {
  const before = text[index - 1] || '';
  const after = text[index + length] || '';
  const beforeWhitespace = isMarkdownWhitespace(before);
  const afterWhitespace = isMarkdownWhitespace(after);
  const beforePunctuation = isMarkdownPunctuation(before);
  const afterPunctuation = isMarkdownPunctuation(after);
  const leftFlanking = !afterWhitespace && (
    !afterPunctuation || beforeWhitespace || beforePunctuation
  );
  const rightFlanking = !beforeWhitespace && (
    !beforePunctuation || afterWhitespace || afterPunctuation
  );
  const isUnderscore = marker === '_';
  return {
    canOpen: isUnderscore
      ? leftFlanking && (!rightFlanking || beforePunctuation)
      : leftFlanking,
    canClose: isUnderscore
      ? rightFlanking && (!leftFlanking || afterPunctuation)
      : rightFlanking
  };
}

// 作用: 判断 CommonMark rule-of-three 是否禁止 opener/closer 配对；输入为两个同字符 delimiter run；输出为禁止配对时返回 true。
function isRuleOfThreeDelimiterMatchBlocked(opener, closer) {
  if (!['*', '_'].includes(opener.marker)) return false;
  if (!opener.canClose && !closer.canOpen) return false;
  const lengthSumIsMultipleOfThree = (opener.length + closer.length) % 3 === 0;
  const bothLengthsAreMultiplesOfThree = opener.length % 3 === 0 && closer.length % 3 === 0;
  return lengthSumIsMultipleOfThree && !bothLengthsAreMultiplesOfThree;
}

// 作用: 计算一次 delimiter 配对消耗的字符数；输入为 opener/closer 剩余长度和 marker；输出为 0、1 或 2。
function getMarkdownDelimiterUseLength(opener, closer) {
  if (opener.marker === '~') {
    return opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 0;
  }
  return opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
}

// 作用: 将 opener 放入 rule-of-three 所需的有限分类；输入为 delimiter run；输出为 marker/canClose/长度模三组成的稳定键。
function getMarkdownDelimiterOpenerStackKey(run) {
  if (run.marker === '~') return '~';
  return `${run.marker}:${run.canClose ? 1 : 0}:${run.length % 3}`;
}

// 作用: 计算当前 closer 可匹配的 opener 分类；输入为 delimiter closer；输出为不违反 rule-of-three 的有限分类键数组。
function getEligibleMarkdownDelimiterOpenerStackKeys(closer) {
  if (closer.marker === '~') return ['~'];
  const keys = [];
  [false, true].forEach((canClose) => {
    [0, 1, 2].forEach((lengthModulo) => {
      const representativeLength = lengthModulo || 3;
      if (!isRuleOfThreeDelimiterMatchBlocked({
        marker: closer.marker,
        canClose,
        length: representativeLength
      }, closer)) {
        keys.push(`${closer.marker}:${canClose ? 1 : 0}:${lengthModulo}`);
      }
    });
  });
  return keys;
}

// 作用: 一次扫描 Markdown inline delimiter runs 并按 flanking/rule-of-three 建立嵌套配对；输入为原文和可选性能诊断对象；输出为可供 URL trim 与 splitter 共用的 run/match 状态。
function analyzeMarkdownInlineDelimiters(text, diagnostics = null) {
  const source = String(text || '');
  const masked = maskMarkdownDelimiterProtectedRanges(text);
  const runs = [];
  const delimiterMarkers = new Set(['*', '_', '~']);
  const blockBreakEnds = [...source.matchAll(/\n[ \t]*\n/g)]
    .map((match) => match.index + match[0].length);
  let segment = 0;
  let nextBlockBreakIndex = 0;
  for (let cursor = 0; cursor < source.length;) {
    while (nextBlockBreakIndex < blockBreakEnds.length && cursor >= blockBreakEnds[nextBlockBreakIndex]) {
      segment += 1;
      nextBlockBreakIndex += 1;
    }
    const marker = source[cursor];
    if (!delimiterMarkers.has(marker) || masked[cursor] !== marker || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (source[end] === marker && masked[end] === marker) end += 1;
    const length = end - cursor;
    const classification = classifyMarkdownDelimiterRun(source, cursor, length, marker);
    const supportsMarker = marker !== '~' || length >= 2;
    runs.push({
      marker,
      start: cursor,
      end,
      length,
      remaining: length,
      active: true,
      segment,
      canOpen: supportsMarker && classification.canOpen,
      canClose: supportsMarker && classification.canClose
    });
    cursor = end;
  }

  const matches = [];
  let candidateVisits = 0;
  let currentSegment = -1;
  let activeOpenerIndexes = [];
  let openerIndexesByStackKey = new Map();
  runs.forEach((closer, closerIndex) => {
    if (closer.segment !== currentSegment) {
      currentSegment = closer.segment;
      activeOpenerIndexes = [];
      openerIndexesByStackKey = new Map();
    }

    // 作用: 读取分类栈中最近且仍可用的 opener；输入为分类键；输出为 run 下标或 -1，并惰性清理失效项。
    const peekActiveOpenerIndex = (stackKey) => {
      const stack = openerIndexesByStackKey.get(stackKey) || [];
      while (stack.length) {
        const candidateIndex = stack[stack.length - 1];
        const candidate = runs[candidateIndex];
        candidateVisits += 1;
        const hasUsableRemainder = candidate.marker === '~'
          ? candidate.remaining >= 2
          : candidate.remaining > 0;
        if (candidate.active && hasUsableRemainder) {
          return candidateIndex;
        }
        stack.pop();
      }
      return -1;
    };

    if (closer.canClose && closer.active) {
      while (closer.remaining > 0) {
        let openerIndex = -1;
        getEligibleMarkdownDelimiterOpenerStackKeys(closer).forEach((stackKey) => {
          openerIndex = Math.max(openerIndex, peekActiveOpenerIndex(stackKey));
        });
        if (openerIndex < 0) break;
        const opener = runs[openerIndex];
        const usedLength = getMarkdownDelimiterUseLength(opener, closer);
        if (usedLength <= 0) {
          opener.active = false;
          continue;
        }
        opener.remaining -= usedLength;
        closer.remaining -= usedLength;
        matches.push({
          marker: closer.marker,
          openerStart: opener.start,
          openerEnd: opener.end,
          closerStart: closer.start,
          closerEnd: closer.end,
          usedLength
        });

        while (activeOpenerIndexes.length && activeOpenerIndexes.at(-1) > openerIndex) {
          runs[activeOpenerIndexes.pop()].active = false;
        }
        const openerStillUsable = opener.marker === '~'
          ? opener.remaining >= 2
          : opener.remaining > 0;
        if (!openerStillUsable) {
          opener.active = false;
          if (activeOpenerIndexes.at(-1) === openerIndex) activeOpenerIndexes.pop();
        }
      }
      if (closer.remaining <= 0) closer.active = false;
    }

    const closerCanRemainOpener = closer.canOpen && closer.active && (
      closer.marker === '~' ? closer.remaining >= 2 : closer.remaining > 0
    );
    if (closerCanRemainOpener) {
      const stackKey = getMarkdownDelimiterOpenerStackKey(closer);
      if (!openerIndexesByStackKey.has(stackKey)) {
        openerIndexesByStackKey.set(stackKey, []);
      }
      openerIndexesByStackKey.get(stackKey).push(closerIndex);
      activeOpenerIndexes.push(closerIndex);
    }
  });
  if (diagnostics && typeof diagnostics === 'object') {
    diagnostics.runCount = runs.length;
    diagnostics.matchCount = matches.length;
    diagnostics.candidateVisits = candidateVisits;
  }
  return { runs, matches };
}

// 作用: 查找候选末尾确属外围 Markdown 的 matched closing run；输入为原文、候选末尾、URL 起点和 inline 分析；输出为应整体移出 URL 的 run 长度。
function getMatchedClosingDelimiterRunLength(original, end, urlStart, analysis) {
  const marker = original[end - 1] || '';
  if (!['*', '_', '~'].includes(marker)) return 0;
  let runStart = end - 1;
  while (runStart > 0 && original[runStart - 1] === marker) runStart -= 1;
  const run = analysis.runs.find((item) => item.start === runStart && item.end === end);
  if (!run) return 0;
  const consumedLength = analysis.matches
    .filter((match) => match.closerStart === runStart && match.openerStart < urlStart)
    .reduce((total, match) => total + match.usedLength, 0);
  return Math.min(consumedLength, end - runStart);
}

// 作用: 去除确属外围 Markdown 的全部动态 closing runs；输入为候选 URL、原文、URL 起点和可复用 inline 分析；输出为不吞签名字符的 URL。
function trimClosingMarkdownDelimiter(value, original, start, inlineAnalysis = null) {
  let output = String(value || '');
  const source = String(original || '');
  const analysis = inlineAnalysis || analyzeMarkdownInlineDelimiters(source);
  while (output) {
    const delimiterLength = getMatchedClosingDelimiterRunLength(
      source,
      start + output.length,
      start,
      analysis
    );
    if (!delimiterLength) break;
    output = output.slice(0, -delimiterLength);
  }
  return output;
}

// 作用: 去除裸 URL 末尾句读和外围 Markdown 闭合符并保留成对圆括号；输入为候选文本、原文和起点；输出为净化 URL。
function trimBareUrl(value, original = value, start = 0, inlineAnalysis = null) {
  let output = String(value || '');
  const cjkPunctuationIndex = output.search(/[，。！？；：、]/u);
  if (cjkPunctuationIndex >= 0) output = output.slice(0, cjkPunctuationIndex);
  output = output.replace(TRAILING_URL_PUNCTUATION, '');
  while (output.endsWith(')')) {
    const openCount = (output.match(/\(/g) || []).length;
    const closeCount = (output.match(/\)/g) || []).length;
    if (closeCount <= openCount) break;
    output = output.slice(0, -1);
  }
  return trimClosingMarkdownDelimiter(output, String(original || ''), start, inlineAnalysis);
}

// 作用: 生成仅用于媒体去重的 canonical key；输入为原始 URL；输出为忽略 scheme/host 大小写、默认端口和 fragment 且保留 query 顺序和值的键。
function getMediaDedupKey(url) {
  const original = String(url || '').trim();
  try {
    const parsed = new URL(original);
    parsed.hash = '';
    const credentials = parsed.username || parsed.password
      ? `${parsed.username}:${parsed.password}@`
      : '';
    return `${parsed.protocol.toLowerCase()}//${credentials}${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return original;
  }
}

// 作用: 统一构造带完整语法与 URL 偏移的媒体记录；输入为媒体语法、类型、位置信息及结构化匹配标记；输出为 occurrence 对象。
function createOccurrence({ syntax, declaredType, url, start, end, urlStart, urlEnd, destinationTailStart = -1, destinationTailEnd = -1, label = '', labelStart = -1, labelEnd = -1, name = '', matchedStructuredMedia = false }) {
  const occurrence = {
    id: `${syntax}:${start}:${end}`,
    syntax,
    declaredType,
    url,
    dedupKey: getMediaDedupKey(url),
    start,
    end,
    urlStart,
    urlEnd,
    destinationTailStart,
    destinationTailEnd,
    label,
    labelStart,
    labelEnd,
    name
  };
  if (matchedStructuredMedia) occurrence.matchedStructuredMedia = true;
  return occurrence;
}

// 作用: 查找支持嵌套且未转义的闭合符号；输入为文本、起点和符号；输出为闭合符号下标或 -1。
function findClosingDelimiter(text, start, openChar, closeChar) {
  let depth = 1;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if (isEscaped(text, cursor)) continue;
    if (text[cursor] === openChar) depth += 1;
    if (text[cursor] === closeChar) depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

// 作用: 读取 Markdown 链接目标及完整语法末尾；输入为左圆括号下标；输出为 URL 起止和语法结束位置。
function readMarkdownDestination(text, openParenIndex) {
  let cursor = openParenIndex + 1;
  while (/\s/.test(text[cursor] || '')) cursor += 1;
  let urlStart = cursor;
  let urlEnd = cursor;
  if (text[cursor] === '<') {
    urlStart = cursor + 1;
    const angleEnd = text.indexOf('>', urlStart);
    if (angleEnd < 0) return null;
    urlEnd = angleEnd;
    cursor = angleEnd + 1;
  } else {
    let nestedParens = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (isEscaped(text, cursor)) {
        cursor += 2;
        continue;
      }
      if (char === '(') {
        nestedParens += 1;
        cursor += 1;
        continue;
      }
      if (char === ')') {
        if (nestedParens === 0) break;
        nestedParens -= 1;
        cursor += 1;
        continue;
      }
      if (/\s/.test(char)) break;
      cursor += 1;
    }
    urlEnd = cursor;
  }
  const destinationTailStart = cursor;
  let quote = '';
  let nestedParens = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (isEscaped(text, cursor)) {
      cursor += 2;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === '(') nestedParens += 1;
    if (char === ')' && nestedParens === 0) {
      return {
        urlStart,
        urlEnd,
        destinationTailStart,
        destinationTailEnd: cursor,
        end: cursor + 1
      };
    }
    if (char === ')') nestedParens -= 1;
    cursor += 1;
  }
  return null;
}

// 作用: 扫描 Markdown 图片和普通链接中的媒体目标；输入为遮蔽文本、原文和配置；输出为媒体 occurrence、语法占用区间及普通链接标签清理区间。
function scanMarkdownLinks(masked, original, options) {
  const occurrences = [];
  const occupiedRanges = [];
  const labelCleanupRanges = [];
  for (let cursor = 0; cursor < masked.length; cursor += 1) {
    const imageMarker = masked[cursor] === '!' && masked[cursor + 1] === '[';
    const linkMarker = masked[cursor] === '[';
    if ((!imageMarker && !linkMarker) || isEscaped(original, cursor)) continue;
    const bracketStart = imageMarker ? cursor + 1 : cursor;
    const bracketEnd = findClosingDelimiter(masked, bracketStart + 1, '[', ']');
    if (bracketEnd < 0) continue;
    let openParen = bracketEnd + 1;
    while (/\s/.test(masked[openParen] || '')) openParen += 1;
    if (masked[openParen] !== '(') continue;
    const destination = readMarkdownDestination(masked, openParen);
    if (!destination) continue;
    occupiedRanges.push({ start: cursor, end: destination.end });
    const url = original.slice(destination.urlStart, destination.urlEnd);
    const classifiedType = classifyMediaUrl(url, {
      ...options,
      forceType: imageMarker ? 'image' : ''
    });
    const structuredType = options.structuredMediaByKey?.get(getMediaDedupKey(url))?.declaredType || '';
    const matchedStructuredMedia = Boolean(structuredType) && (!classifiedType || classifiedType === 'unknown');
    const declaredType = matchedStructuredMedia ? structuredType : classifiedType;
    if (!declaredType) {
      const labelStart = bracketStart + 1;
      const maskedLabel = masked.slice(labelStart, bracketEnd);
      const nestedAutolinkPattern = /<(https?:\/\/[^\s<>]+)>/gi;
      let nestedAutolink = nestedAutolinkPattern.exec(maskedLabel);
      while (nestedAutolink) {
        if (options.structuredMediaByKey?.has(getMediaDedupKey(nestedAutolink[1]))) {
          const start = labelStart + nestedAutolink.index;
          labelCleanupRanges.push({ start, end: start + nestedAutolink[0].length });
        }
        nestedAutolink = nestedAutolinkPattern.exec(maskedLabel);
      }
      cursor = destination.end - 1;
      continue;
    }
    occurrences.push(createOccurrence({
      syntax: imageMarker ? 'markdown_image' : 'markdown_link',
      declaredType,
      url,
      start: cursor,
      end: destination.end,
      urlStart: destination.urlStart,
      urlEnd: destination.urlEnd,
      destinationTailStart: destination.destinationTailStart,
      destinationTailEnd: destination.destinationTailEnd,
      label: original.slice(bracketStart + 1, bracketEnd),
      labelStart: bracketStart + 1,
      labelEnd: bracketEnd,
      name: declaredType === 'file' ? original.slice(bracketStart + 1, bracketEnd) : '',
      matchedStructuredMedia
    }));
    cursor = destination.end - 1;
  }
  return { occurrences, occupiedRanges, labelCleanupRanges };
}

// 作用: 扫描代码区和外层 Markdown 链接之外的完整 HTTP(S) autolink；输入为遮蔽文本、原文、媒体配置和占用区间；输出为包含尖括号完整区间的媒体 occurrence。
function scanMarkdownAutolinks(masked, original, options, occupiedRanges = []) {
  const occurrences = [];
  const pattern = /<(https?:\/\/[^\s<>]+)>/gi;
  let match = pattern.exec(masked);
  while (match) {
    const start = match.index;
    const end = pattern.lastIndex;
    const url = match[1];
    if (!isEscaped(original, start) && !overlapsRanges(start, end, occupiedRanges)) {
      const classifiedType = classifyMediaUrl(url, options);
      const structuredItem = options.structuredMediaByKey?.get(getMediaDedupKey(url));
      const structuredType = structuredItem?.declaredType || '';
      const matchedStructuredMedia = Boolean(structuredType) && (!classifiedType || classifiedType === 'unknown');
      const declaredType = matchedStructuredMedia ? structuredType : classifiedType;
      if (declaredType) {
        occurrences.push(createOccurrence({
          syntax: 'markdown_autolink',
          declaredType,
          url,
          start,
          end,
          urlStart: start + 1,
          urlEnd: end - 1,
          name: declaredType === 'file' ? String(structuredItem?.name || '') : '',
          matchedStructuredMedia
        }));
      }
    }
    match = pattern.exec(masked);
  }
  return occurrences;
}

// 作用: 判断候选区间是否与已解析 Markdown 语法重叠；输入为起止位置与占用区间；输出为布尔值。
function overlapsRanges(start, end, occupiedRanges) {
  return occupiedRanges.some((item) => start < item.end && end > item.start);
}

// 作用: 扫描未被 Markdown 语法包裹的媒体 URL；输入为遮蔽文本、原文、配置、语法占用区间和共享 delimiter 分析；输出为裸 URL occurrence。
function scanBareUrls(masked, original, options, occupiedRanges, inlineAnalysis) {
  const occurrences = [];
  const pattern = /https?:\/\/[^\s<>"`]+/gi;
  let match = pattern.exec(masked);
  while (match) {
    const url = trimBareUrl(
      original.slice(match.index, match.index + match[0].length),
      original,
      match.index,
      inlineAnalysis
    );
    const start = match.index;
    const end = start + url.length;
    const classifiedType = classifyMediaUrl(url, options);
    const structuredItem = options.structuredMediaByKey?.get(getMediaDedupKey(url));
    const structuredType = structuredItem?.declaredType || '';
    const matchedStructuredMedia = Boolean(structuredType) && (!classifiedType || classifiedType === 'unknown');
    const declaredType = matchedStructuredMedia ? structuredType : classifiedType;
    if (declaredType && !overlapsRanges(start, end, occupiedRanges)) {
      occurrences.push(createOccurrence({
        syntax: 'bare',
        declaredType,
        url,
        start,
        end,
        urlStart: start,
        urlEnd: end,
        name: declaredType === 'file' ? String(structuredItem?.name || '') : '',
        matchedStructuredMedia
      }));
    }
    match = pattern.exec(masked);
  }
  return occurrences;
}

// 作用: 解析 FastGPT 原始 Markdown 和结构化媒体；输入为正文、媒体字段与扩展名配置；输出为不修改原文的渲染计划。
function createReplyRenderPlan({
  markdown = '',
  structuredMedia = [],
  imageExtensions = [],
  fileExtensions = [],
  delimiterDiagnostics = null
} = {}) {
  const original = String(markdown || '');
  const options = {
    imageExtensions: new Set(imageExtensions.map((value) => String(value).toLowerCase())),
    fileExtensions: new Set(fileExtensions.map((value) => String(value).toLowerCase()))
  };
  const normalizedStructuredMedia = structuredMedia
    .map((item, index) => {
      const type = String(item?.type || item?.kind || '').toLowerCase();
      const url = String(item?.url || item?.image_url?.url || item?.file_url?.url || '').trim();
      if (!['image', 'file'].includes(type) || !classifyMediaUrl(url, {
        ...options,
        forceType: type
      })) return null;
      return {
        id: `structured:${type}:${index}`,
        type,
        declaredType: type,
        placement: type === 'image' ? 'append' : 'separate',
        url,
        dedupKey: getMediaDedupKey(url),
        alt: String(item.alt || item.title || '').trim(),
        name: String(item.name || item.filename || '').trim()
      };
    })
    .filter(Boolean);
  options.structuredMediaByKey = new Map(
    normalizedStructuredMedia.map((item) => [item.dedupKey, item])
  );
  const masked = maskProtectedMarkdown(original);
  const markdownScan = scanMarkdownLinks(masked, original, options);
  const autolinkOccurrences = scanMarkdownAutolinks(
    masked,
    original,
    options,
    markdownScan.occupiedRanges
  );
  const occupiedRanges = [
    ...markdownScan.occupiedRanges,
    ...autolinkOccurrences.map((item) => ({ start: item.start, end: item.end }))
  ];
  const inlineAnalysis = analyzeMarkdownInlineDelimiters(original, delimiterDiagnostics);
  const bareOccurrences = scanBareUrls(masked, original, options, occupiedRanges, inlineAnalysis);
  const occurrences = [...autolinkOccurrences, ...markdownScan.occurrences, ...bareOccurrences]
    .sort((left, right) => left.start - right.start);
  const uniqueMediaByKey = new Map();
  [...occurrences, ...normalizedStructuredMedia].forEach((item) => {
    if (!uniqueMediaByKey.has(item.dedupKey)) {
      uniqueMediaByKey.set(item.dedupKey, {
        url: item.url,
        dedupKey: item.dedupKey,
        declaredType: item.declaredType,
        name: item.name || '',
        firstId: item.id
      });
    }
  });
  return {
    markdown: original,
    occurrences,
    labelCleanupRanges: markdownScan.labelCleanupRanges,
    structuredMedia: normalizedStructuredMedia,
    uniqueMedia: [...uniqueMediaByKey.values()]
  };
}

// 作用: 按原文位置从后向前应用替换；输入为 Markdown 和替换区间；输出为不会产生下标漂移的新文本。
function applyReplacements(markdown, replacements) {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce((output, item) => `${output.slice(0, item.start)}${item.value}${output.slice(item.end)}`, markdown);
}

// 作用: 解析某个 URL 的物化结果；输入为 occurrence、结果 Map；输出为稳定媒体类型和最终 URL。
function resolveOccurrence(item, resolutionByUrl) {
  const resolution = resolutionByUrl.get(item.dedupKey) || resolutionByUrl.get(item.url) || {
    ok: false,
    type: item.declaredType,
    originalUrl: item.url,
    errorCode: 'FASTGPT_MEDIA_URL_UNREADABLE'
  };
  return {
    ...resolution,
    type: resolution.type || item.declaredType,
    originalUrl: resolution.originalUrl || item.url,
    url: resolution.ok ? resolution.url : item.url,
    materialized: Boolean(resolution.ok)
  };
}

// 作用: 从媒体标签中移除所有 HTTP(S) URL；输入为原始 Markdown 标签；输出为不含原始链接且保留安全可见文本的标签。
function sanitizeMediaLabel(label) {
  let output = String(label || '').replace(/<https?:\/\/[^\s<>]+>/gi, '');
  while (/https?:\/\//i.test(output)) {
    const replacements = collectSafePreviewUrlReplacements(output);
    if (!replacements.length) break;
    const sanitized = applyReplacements(output, replacements);
    if (sanitized === output) break;
    output = sanitized;
  }
  return output.trim();
}

// 作用: 判断媒体展示文本是否含 URL 或凭据赋值；输入为 title/alt 文本；输出为需要丢弃敏感展示文本时返回 true。
function containsSensitiveMediaText(value) {
  const text = String(value || '');
  return /https?:\/\//i.test(text) ||
    containsCredentialText(text);
}

// 作用: 清理并转义结构化图片 alt；输入为外部结构化 alt；输出为单行、无凭据且不会闭合 Markdown 图片标签的文本。
function sanitizeStructuredImageAlt(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized || containsSensitiveMediaText(normalized)) return '';
  return normalized
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

// 作用: 判断 Markdown 媒体 destination 的 title 尾段是否敏感；输入为渲染计划和 occurrence；输出为布尔值。
function hasSensitiveDestinationTail(plan, item) {
  if (item.destinationTailStart < 0 || item.destinationTailEnd <= item.destinationTailStart) return false;
  return containsSensitiveMediaText(
    plan.markdown.slice(item.destinationTailStart, item.destinationTailEnd)
  );
}

// 作用: 计算移除裸文件 URL 时的最小清理区间；输入为原文和 occurrence；输出为替换起止和值。
function buildFileRemovalReplacement(markdown, item) {
  if (item.syntax === 'markdown_link' || item.syntax === 'markdown_image') {
    return { start: item.start, end: item.end, value: sanitizeMediaLabel(item.label) };
  }
  const lineStart = markdown.lastIndexOf('\n', item.start - 1) + 1;
  const nextNewline = markdown.indexOf('\n', item.end);
  const lineEnd = nextNewline >= 0 ? nextNewline : markdown.length;
  const remainingLine = `${markdown.slice(lineStart, item.start)}${markdown.slice(item.end, lineEnd)}`;
  const isEmptyContainerLine = /^ {0,3}(?:[-+*][ \t]*|\d{1,9}[.)][ \t]*|(?:>[ \t]*)+)\r?$/u
    .test(remainingLine);
  if (!remainingLine.trim() || isEmptyContainerLine) {
    return {
      start: lineStart,
      end: nextNewline >= 0 ? nextNewline + 1 : lineEnd,
      value: ''
    };
  }
  const hasWhitespaceBefore = item.start > 0 && /\s/.test(markdown[item.start - 1]);
  const hasWhitespaceAfter = item.end < markdown.length && /[ \t]/.test(markdown[item.end]);
  return {
    start: item.start,
    end: hasWhitespaceBefore && hasWhitespaceAfter ? item.end + 1 : item.end,
    value: ''
  };
}

// 作用: 在不重排原文的前提下追加独立 Markdown 块；输入为现有正文和新块；输出为至少由一个空行分隔的正文。
function appendMarkdownBlock(markdown, block) {
  if (!markdown) return block;
  const trailingNewlines = (markdown.match(/\n*$/) || [''])[0].length;
  return `${markdown}${'\n'.repeat(Math.max(0, 2 - trailingNewlines))}${block}`;
}

// 作用: 合成最终 Markdown、无图正文和独立媒体队列；输入为渲染计划与 URL 结果；输出为 Worker 可直接发送的渲染结果。
function renderReplyPlan(plan, resolutionByUrl = new Map()) {
  let imageNumber = 0;
  const labelCleanupReplacements = (plan.labelCleanupRanges || []).map((item) => ({
    start: item.start,
    end: item.end,
    value: ''
  }));
  const markdownReplacements = [...labelCleanupReplacements];
  const fallbackReplacements = [...labelCleanupReplacements];
  const images = [];
  const files = [];
  const queuedImageKeys = new Set();
  const queuedFileKeys = new Set();
  const structuredMatchedKeys = new Set(
    plan.occurrences
      .filter((item) => item.matchedStructuredMedia)
      .map((item) => item.dedupKey)
  );
  // 作用: 为无显式描述的图片生成稳定编号；输入为可选描述；输出为显式描述或递增的中文图片名。
  const resolveImageAlt = (explicitAlt = '') => {
    if (explicitAlt) return explicitAlt;
    imageNumber += 1;
    return `图片${imageNumber}`;
  };

  plan.occurrences.forEach((item) => {
    const resolved = resolveOccurrence(item, resolutionByUrl);
    if (resolved.type === 'file') {
      const fileReplacement = buildFileRemovalReplacement(plan.markdown, item);
      const visibleLabel = fileReplacement.value;
      markdownReplacements.push(fileReplacement);
      fallbackReplacements.push(fileReplacement);
      if (!queuedFileKeys.has(item.dedupKey)) {
        queuedFileKeys.add(item.dedupKey);
        files.push({ ...resolved, name: resolved.name || item.name || visibleLabel || 'file' });
      }
      return;
    }

    if (resolved.type === 'image') {
      const safeLabel = sanitizeMediaLabel(item.label);
      const alt = resolveImageAlt(safeLabel || resolved.alt);
      const shouldRenderWholeImageToken = item.syntax === 'bare' ||
        item.syntax === 'markdown_autolink' ||
        (item.syntax === 'markdown_link' && !resolved.materialized);
      if (shouldRenderWholeImageToken) {
        markdownReplacements.push({ start: item.start, end: item.end, value: `![${alt}](${resolved.url})` });
      } else {
        markdownReplacements.push({ start: item.urlStart, end: item.urlEnd, value: resolved.url });
        if (hasSensitiveDestinationTail(plan, item)) {
          markdownReplacements.push({
            start: item.destinationTailStart,
            end: item.destinationTailEnd,
            value: ''
          });
        }
        if (safeLabel !== item.label) {
          markdownReplacements.push({ start: item.labelStart, end: item.labelEnd, value: safeLabel || alt });
        } else if (item.syntax === 'markdown_image' && !item.label) {
          markdownReplacements.push({ start: item.labelStart, end: item.labelEnd, value: alt });
        }
      }
      fallbackReplacements.push({ start: item.start, end: item.end, value: alt });
      if (!queuedImageKeys.has(item.dedupKey)) {
        queuedImageKeys.add(item.dedupKey);
        images.push({ ...resolved, alt });
      }
      return;
    }

    markdownReplacements.push({ start: item.urlStart, end: item.urlEnd, value: resolved.url });
    fallbackReplacements.push({ start: item.urlStart, end: item.urlEnd, value: resolved.url });
  });

  let markdown = applyReplacements(plan.markdown, markdownReplacements);
  let fallbackMarkdown = applyReplacements(plan.markdown, fallbackReplacements);

  plan.structuredMedia.forEach((item) => {
    const resolved = resolveOccurrence(item, resolutionByUrl);
    if (resolved.type === 'image') {
      const alt = resolveImageAlt(sanitizeStructuredImageAlt(item.alt || resolved.alt));
      if (!structuredMatchedKeys.has(item.dedupKey)) {
        markdown = appendMarkdownBlock(markdown, `![${alt}](${resolved.url})`);
      }
      if (!queuedImageKeys.has(item.dedupKey)) {
        queuedImageKeys.add(item.dedupKey);
        images.push({ ...resolved, alt });
      }
    } else if (resolved.type === 'file' && !queuedFileKeys.has(item.dedupKey)) {
      queuedFileKeys.add(item.dedupKey);
      files.push({ ...resolved, name: resolved.name || item.name || 'file' });
    }
  });

  return { markdown, fallbackMarkdown, images, files };
}

// 作用: 收集流式预览中全部 HTTP(S) 目标的安全替换；输入为已提交 Markdown；输出为隐藏 URL 且保留普通链接标签的替换区间。
function collectSafePreviewUrlReplacements(markdown) {
  const replacements = [];
  const occupiedRanges = [];
  const inlineAnalysis = analyzeMarkdownInlineDelimiters(markdown);
  for (let cursor = 0; cursor < markdown.length; cursor += 1) {
    const imageMarker = markdown[cursor] === '!' && markdown[cursor + 1] === '[';
    const linkMarker = markdown[cursor] === '[';
    if ((!imageMarker && !linkMarker) || isEscaped(markdown, cursor)) continue;
    const bracketStart = imageMarker ? cursor + 1 : cursor;
    const bracketEnd = findClosingDelimiter(markdown, bracketStart + 1, '[', ']');
    if (bracketEnd < 0) continue;
    let openParen = bracketEnd + 1;
    while (/\s/.test(markdown[openParen] || '')) openParen += 1;
    if (markdown[openParen] !== '(') continue;
    const destination = readMarkdownDestination(markdown, openParen);
    if (!destination) continue;
    const url = markdown.slice(destination.urlStart, destination.urlEnd);
    if (!/^https?:\/\//i.test(url)) {
      cursor = destination.end - 1;
      continue;
    }
    occupiedRanges.push({ start: cursor, end: destination.end });
    replacements.push({
      start: cursor,
      end: destination.end,
      value: imageMarker ? '' : markdown.slice(bracketStart + 1, bracketEnd)
    });
    cursor = destination.end - 1;
  }

  const pattern = /https?:\/\/[^\s<>"`]+/gi;
  let match = pattern.exec(markdown);
  while (match) {
    const url = trimBareUrl(match[0], markdown, match.index, inlineAnalysis);
    const start = match.index;
    const end = start + url.length;
    if (url && !overlapsRanges(start, end, occupiedRanges)) {
      replacements.push({ start, end, value: '' });
    }
    match = pattern.exec(markdown);
  }
  return replacements;
}

// 作用: 查找当前增量末尾尚未闭合的 URL 或 Markdown 链接；输入为累积文本；输出为应暂缓展示的起始下标或 -1。
function findPendingTokenStart(markdown) {
  const lineStart = markdown.lastIndexOf('\n') + 1;
  const tail = markdown.slice(lineStart);
  let markdownStart = -1;
  const completedMarkdownRanges = [];
  for (let cursor = 0; cursor < tail.length; cursor += 1) {
    const imageMarker = tail[cursor] === '!' && tail[cursor + 1] === '[';
    const linkMarker = tail[cursor] === '[';
    if ((!imageMarker && !linkMarker) || isEscaped(tail, cursor)) continue;
    const bracketStart = imageMarker ? cursor + 1 : cursor;
    const bracketEnd = findClosingDelimiter(tail, bracketStart + 1, '[', ']');
    if (bracketEnd < 0) {
      if (imageMarker) markdownStart = markdownStart < 0 ? cursor : markdownStart;
      continue;
    }
    let openParen = bracketEnd + 1;
    while (/\s/.test(tail[openParen] || '')) openParen += 1;
    if (tail[openParen] !== '(') {
      if (imageMarker) markdownStart = markdownStart < 0 ? cursor : markdownStart;
      continue;
    }
    const destination = readMarkdownDestination(tail, openParen);
    if (!destination) {
      markdownStart = markdownStart < 0 ? cursor : markdownStart;
      continue;
    }
    completedMarkdownRanges.push({ start: cursor, end: destination.end });
    cursor = destination.end - 1;
  }
  const urlMatches = [...tail.matchAll(/https?:\/\/\S*$/gi)];
  const pendingUrl = urlMatches.find((match) => (
    trimBareUrl(match[0]) === match[0]
    && !completedMarkdownRanges.some(
      (range) => match.index >= range.start && match.index < range.end
    )
  ));
  const urlStart = pendingUrl ? pendingUrl.index : -1;
  const relative = [markdownStart, urlStart].filter((value) => value >= 0);
  return relative.length ? lineStart + Math.min(...relative) : -1;
}

// 作用: 构造不暴露任何 HTTP(S) URL 的流式预览；输入为当前 Markdown 与兼容配置；输出为可安全覆盖到企微的文本。
function buildSafeStreamPreview(markdown, options = {}) {
  const value = String(markdown || '');
  const pendingStart = findPendingTokenStart(value);
  const committed = pendingStart >= 0 ? value.slice(0, pendingStart) : value;
  void options;
  let preview = committed;
  while (/https?:\/\//i.test(preview)) {
    const replacements = collectSafePreviewUrlReplacements(preview);
    if (!replacements.length) break;
    const sanitized = applyReplacements(preview, replacements);
    if (sanitized === preview) break;
    preview = sanitized;
  }
  return preview.replace(/[ \t]+$/gm, '').trim();
}

// 作用: 按字符或 UTF-8 字节计算企微内容长度；输入为文本和单位；输出为非负整数。
function measureReplyText(text, unit) {
  return unit === 'bytes'
    ? Buffer.byteLength(String(text || ''), 'utf8')
    : String(text || '').length;
}

// 作用: 判断某行是否能关闭指定 fenced code；输入为候选行和起始 fence；输出为满足同字符且长度不短于起始 fence 的布尔值。
function isClosingFenceLine(line, openingMarker) {
  const match = String(line || '').match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(
    match
    && match[1][0] === openingMarker[0]
    && match[1].length >= openingMarker.length
  );
}

// 作用: 把任意文本按字符或 UTF-8 字节上限无损拆分；输入为文本、限制和单位；输出为按顺序拼接可还原原文的片段。
function splitTextExactly(text, limit, unit) {
  const parts = [];
  let current = '';
  for (const char of String(text || '')) {
    if (measureReplyText(char, unit) > limit) {
      throw new RangeError('MARKDOWN_CHARACTER_TOO_LARGE');
    }
    const candidate = `${current}${char}`;
    if (current && measureReplyText(candidate, unit) > limit) {
      parts.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// 作用: 选择不会被内容提前闭合的反引号围栏；输入为待安全表示的原文；输出为至少三个反引号的 marker。
function chooseSafeTextFence(value) {
  const runs = String(value || '').match(/`+/g) || [];
  const longestRun = runs.reduce((length, run) => Math.max(length, run.length), 0);
  return '`'.repeat(Math.max(3, longestRun + 1));
}

// 作用: 把过小上限下的原子 Markdown 转为完整行内代码片段；输入为原文、限制和单位；输出为各自合法且可逆的安全片段。
function splitAsSafeInlineCode(value, limit, unit) {
  const runs = String(value || '').match(/`+/g) || [];
  const longestRun = runs.reduce((length, run) => Math.max(length, run.length), 0);
  const marker = '`'.repeat(Math.max(1, longestRun + 1));
  const wrapperSize = measureReplyText(`${marker}  ${marker}`, unit);
  if (wrapperSize >= limit) return splitTextExactly(value, limit, unit);
  return splitTextExactly(value, limit - wrapperSize, unit)
    .map((part) => `${marker} ${part} ${marker}`);
}

// 作用: 把无法原子容纳的 Markdown 语法转为显式 text fence；输入为原文、限制和单位；输出为合法且可逆的安全文本片段。
function splitAsSafeText(value, limit, unit) {
  const marker = chooseSafeTextFence(value);
  const opening = `${marker}text\n`;
  const closing = `\n${marker}`;
  const wrapperSize = measureReplyText(`${opening}${closing}`, unit);
  if (wrapperSize >= limit) {
    return splitAsSafeInlineCode(value, limit, unit);
  }
  const contentLimit = limit - wrapperSize;
  return splitTextExactly(value, contentLimit, unit)
    .map((part) => `${opening}${part}${closing}`);
}

// 作用: 把 Markdown 按空行和 fenced code 边界归并并保留全部分隔符；输入为正文；输出为直接拼接即可还原原文的字符串数组。
function collectMarkdownBlocks(markdown) {
  const records = String(markdown || '').match(/[^\n]*(?:\n|$)/g) || [];
  const blocks = [];
  let current = '';
  let fenceMarker = '';
  // 作用: 合并相邻换行/空白分隔块；输入为原始分隔文本；输出为更新后的块队列。
  const pushSeparator = (separator) => {
    if (!separator) return;
    const lastIndex = blocks.length - 1;
    if (lastIndex >= 0 && /^\s+$/.test(blocks[lastIndex])) {
      blocks[lastIndex] += separator;
    } else {
      blocks.push(separator);
    }
  };
  // 作用: 提交当前语义块并把末尾行结束符保留为独立分隔块；输入为空；输出为更新后的块队列。
  const flush = () => {
    if (!current) return;
    let separator = '';
    if (current.endsWith('\n')) {
      current = current.slice(0, -1);
      separator = '\n';
    }
    if (current) blocks.push(current);
    current = '';
    pushSeparator(separator);
  };
  records.filter((record) => record !== '').forEach((record) => {
    const line = record.endsWith('\n') ? record.slice(0, -1) : record;
    if (fenceMarker) {
      current += record;
      if (isClosingFenceLine(line, fenceMarker)) {
        fenceMarker = '';
        flush();
      }
      return;
    }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      flush();
      fenceMarker = fence[1];
      current = record;
      return;
    }
    if (!line.trim()) {
      flush();
      pushSeparator(record);
      return;
    }
    current += record;
  });
  flush();
  return blocks;
}

// 作用: 读取完整 Markdown 链接或图片 token 的末尾；输入为原文和起点；输出为语法末尾，非链接返回 -1。
function readBracketMarkdownTokenEnd(value, cursor) {
  const imageMarker = value[cursor] === '!' && value[cursor + 1] === '[';
  const linkMarker = value[cursor] === '[';
  if ((!imageMarker && !linkMarker) || isEscaped(value, cursor)) {
    return -1;
  }
  const bracketStart = imageMarker ? cursor + 1 : cursor;
  const bracketEnd = findClosingDelimiter(value, bracketStart + 1, '[', ']');
  let openParen = bracketEnd + 1;
  while (bracketEnd >= 0 && /\s/.test(value[openParen] || '')) openParen += 1;
  const destination = bracketEnd >= 0 && value[openParen] === '('
    ? readMarkdownDestination(value, openParen)
    : null;
  return destination ? destination.end : -1;
}

// 作用: 读取匹配同长度 marker 的行内代码末尾；输入为原文和反引号起点；输出为完整 token 末尾，未闭合返回 -1。
function readInlineCodeTokenEnd(value, cursor) {
  if (value[cursor] !== '`' || isEscaped(value, cursor)) return -1;
  let openingEnd = cursor;
  while (value[openingEnd] === '`') openingEnd += 1;
  const markerLength = openingEnd - cursor;
  let searchCursor = openingEnd;
  while (searchCursor < value.length) {
    const candidate = value.indexOf('`', searchCursor);
    if (candidate < 0) return -1;
    let candidateEnd = candidate;
    while (value[candidateEnd] === '`') candidateEnd += 1;
    if (candidateEnd - candidate === markerLength && !isEscaped(value, candidate)) {
      return candidateEnd;
    }
    searchCursor = candidateEnd;
  }
  return -1;
}

// 作用: 从共享 delimiter-run 分析读取从指定 opener 开始的最外层 token 末尾；输入为 inline 分析和起点；输出为 closing run 末尾，未匹配返回 -1。
function readMatchedDelimiterTokenEnd(inlineAnalysis, cursor) {
  const matchingEnds = inlineAnalysis.matches
    .filter((match) => match.openerStart === cursor)
    .map((match) => match.closerEnd);
  return matchingEnds.length ? Math.max(...matchingEnds) : -1;
}

// 作用: 读取需原子保护的行内 Markdown token；输入为原文和起点；输出为完整 token 末尾，普通文本返回 -1。
function readAtomicMarkdownTokenEnd(value, cursor, inlineAnalysis = null) {
  const analysis = inlineAnalysis || analyzeMarkdownInlineDelimiters(value);
  const bracketEnd = readBracketMarkdownTokenEnd(value, cursor);
  if (bracketEnd >= 0) return bracketEnd;

  const autolink = value.slice(cursor).match(/^<https?:\/\/[^\s<>]+>/i);
  if (autolink && !isEscaped(value, cursor)) return cursor + autolink[0].length;

  const inlineCodeEnd = readInlineCodeTokenEnd(value, cursor);
  if (inlineCodeEnd >= 0) return inlineCodeEnd;

  const delimitedEnd = readMatchedDelimiterTokenEnd(analysis, cursor);
  if (delimitedEnd >= 0) return delimitedEnd;

  const bareUrl = value.slice(cursor).match(/^https?:\/\/[^\s<>"`]+/i);
  if (bareUrl && !isEscaped(value, cursor)) {
    const trimmedUrl = trimBareUrl(bareUrl[0], value, cursor, analysis);
    if (trimmedUrl) return cursor + trimmedUrl.length;
  }
  return -1;
}

// 作用: 把普通块拆为完整行内 Markdown 原子、空白和普通文本 token；输入为 Markdown 块；输出为保持原始顺序的 token 数组。
function tokenizePlainMarkdownBlock(block) {
  const value = String(block || '');
  const inlineAnalysis = analyzeMarkdownInlineDelimiters(value);
  const tokens = [];
  let plainStart = 0;
  let cursor = 0;
  // 作用: 把非原子区间按空白边界写入 token 队列；输入为区间末尾；输出为更新后的 token 数组。
  const pushPlainTokens = (end) => {
    const plainTokens = value.slice(plainStart, end).match(/\s+|[^\s]+/g) || [];
    tokens.push(...plainTokens);
  };
  while (cursor < value.length) {
    const tokenEnd = readAtomicMarkdownTokenEnd(value, cursor, inlineAnalysis);
    if (tokenEnd < 0) {
      cursor += 1;
      continue;
    }
    pushPlainTokens(cursor);
    tokens.push(value.slice(cursor, tokenEnd));
    cursor = tokenEnd;
    plainStart = cursor;
  }
  pushPlainTokens(value.length);
  return tokens;
}

// 作用: 判断 token 是否为必须整体发送的完整行内 Markdown 语法；输入为单个 token；输出为链接、代码、强调或 URL 时返回 true。
function isAtomicMarkdownToken(token) {
  const value = String(token || '');
  const inlineAnalysis = analyzeMarkdownInlineDelimiters(value);
  return Boolean(value) && readAtomicMarkdownTokenEnd(value, 0, inlineAnalysis) === value.length;
}

// 作用: 在空白 token 间拆分单个普通长行且不切断 inline atom；输入为文本、限制和单位；输出为片段数组。
function splitPlainMarkdownLine(block, limit, unit) {
  const tokens = tokenizePlainMarkdownBlock(block);
  const parts = [];
  let current = '';
  // 作用: 提交普通文本缓冲且不裁剪空白；输入为空；输出为更新后的片段数组。
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  tokens.forEach((token) => {
    if (measureReplyText(token, unit) > limit && isAtomicMarkdownToken(token)) {
      flush();
      parts.push(...splitAsSafeText(token, limit, unit));
      return;
    }
    const tokenParts = measureReplyText(token, unit) > limit
      ? splitTextExactly(token, limit, unit)
      : [token];
    tokenParts.forEach((part) => {
      const candidate = `${current}${part}`;
      if (current && measureReplyText(candidate, unit) > limit) {
        flush();
      }
      current += part;
      if (measureReplyText(current, unit) === limit) flush();
    });
  });
  flush();
  return parts.filter((part) => part.length > 0);
}

// 作用: 判断逻辑行是否以 list/blockquote 容器 marker 开始；输入为含可选换行的原始行；输出为容器行时返回 true。
function isMarkdownContainerLine(line) {
  return /^ {0,3}(?:>|[-+*][ \t]+|\d{1,9}[.)][ \t]+)/.test(String(line || ''));
}

// 作用: 优先按完整逻辑行打包普通 Markdown，仅当单行自身超限时拆分；输入为普通块、限制和单位；输出为不拆散可容纳行 marker 的片段数组。
function splitPlainMarkdownBlock(block, limit, unit) {
  const records = String(block || '').match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  const parts = [];
  let current = '';
  // 作用: 提交已按逻辑行打包的当前片段；输入为空；输出为更新后的片段队列。
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  records.forEach((record) => {
    if (measureReplyText(record, unit) > limit) {
      flush();
      const oversizedParts = isMarkdownContainerLine(record)
        ? splitAsSafeText(record, limit, unit)
        : splitPlainMarkdownLine(record, limit, unit);
      parts.push(...oversizedParts);
      return;
    }
    const candidate = `${current}${record}`;
    if (current && measureReplyText(candidate, unit) > limit) flush();
    current += record;
  });
  flush();
  return parts.filter((part) => part.length > 0);
}

// 作用: 按内容行优先、必要时按字符拆分 fenced code 正文；输入为代码正文、可用内容上限和单位；输出为拼接可还原正文的片段。
function splitFenceContent(content, contentLimit, unit) {
  const records = String(content || '').match(/[^\n]*(?:\n|$)/g) || [];
  const parts = [];
  let current = '';
  // 作用: 提交当前代码正文缓冲；输入为空；输出为更新后的代码片段数组。
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  records.filter((record) => record !== '').forEach((record) => {
    const recordParts = measureReplyText(record, unit) > contentLimit
      ? splitTextExactly(record, contentLimit, unit)
      : [record];
    recordParts.forEach((part) => {
      const candidate = `${current}${part}`;
      if (current && measureReplyText(candidate, unit) > contentLimit) flush();
      current += part;
      if (measureReplyText(current, unit) === contentLimit) flush();
    });
  });
  flush();
  return parts;
}

// 作用: 读取 fenced code 的开围栏、正文和闭围栏；输入为完整代码块；输出为可重开围栏的结构或 null。
function parseFencedBlock(block) {
  const value = String(block || '');
  const firstNewline = value.indexOf('\n');
  if (firstNewline < 0) return null;
  const opening = value.slice(0, firstNewline);
  const marker = (opening.match(/^ {0,3}(`{3,}|~{3,})/) || [])[1];
  if (!marker) return null;
  const closingPattern = new RegExp(`\\n {0,3}${marker[0]}{${marker.length},}\\s*$`);
  const closingMatch = value.match(closingPattern);
  if (!closingMatch) return null;
  const closingStart = value.length - closingMatch[0].length + 1;
  return {
    opening,
    marker,
    content: value.slice(firstNewline + 1, Math.max(firstNewline + 1, closingStart - 1)),
    closing: value.slice(closingStart)
  };
}

// 作用: 拆分超长 fenced code 并为每段重新包裹 fence；输入为代码块、限制和单位；输出为合法代码块数组。
function splitOversizedFence(block, limit, unit) {
  const parsed = parseFencedBlock(block);
  if (!parsed) return splitAsSafeText(block, limit, unit);
  const wrapper = `${parsed.opening}\n\n${parsed.closing}`;
  const wrapperSize = measureReplyText(wrapper, unit);
  if (wrapperSize >= limit) return splitAsSafeText(block, limit, unit);
  if (!parsed.content) return [`${parsed.opening}\n${parsed.closing}`];
  const contentLimit = limit - wrapperSize;
  return splitFenceContent(parsed.content, contentLimit, unit)
    .map((part) => `${parsed.opening}\n${part}\n${parsed.closing}`);
}

// 作用: 按数据行拆分超长表格并重复表头；输入为表格、限制和单位；输出为仅在完整数据行之间切分的合法表格片段。
function splitOversizedTable(block, limit, unit) {
  const lines = block.split('\n');
  const header = lines.slice(0, 2);
  const rows = lines.slice(2);
  const headerText = header.join('\n');
  if (measureReplyText(headerText, unit) > limit) {
    return splitAsSafeText(block, limit, unit);
  }
  if (!rows.length) return [headerText];
  const parts = [];
  let currentRows = [];
  // 作用: 提交当前表格数据行并重置缓冲；输入为空；输出为更新后的表格片段队列。
  const flush = () => {
    if (currentRows.length) parts.push([...header, ...currentRows].join('\n'));
    currentRows = [];
  };
  if (rows.some((row) => measureReplyText([...header, row].join('\n'), unit) > limit)) {
    return splitAsSafeText(block, limit, unit);
  }
  rows.forEach((row) => {
    const candidate = [...header, ...currentRows, row].join('\n');
    if (measureReplyText(candidate, unit) <= limit) {
      currentRows.push(row);
      return;
    }
    flush();
    currentRows.push(row);
  });
  flush();
  return parts;
}

// 作用: 针对代码、表格或普通文本拆分单个超长块；输入为 Markdown 块、限制和单位；输出为合法片段数组。
function splitOversizedMarkdownBlock(block, limit, unit) {
  if (/^ {0,3}(`{3,}|~{3,})/.test(block)) {
    return splitOversizedFence(block, limit, unit);
  }
  const lines = block.split('\n');
  if (lines.length >= 2 && /^\s*\|?.*\|.*\|?\s*$/.test(lines[0]) && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
    return splitOversizedTable(block, limit, unit);
  }
  return splitPlainMarkdownBlock(block, limit, unit);
}

// 作用: 把无法整体容纳的跨气泡纯空白折叠为最小 Markdown 分隔；输入为空白文本；输出为空字符、单空格或一/两个换行。
function collapseWhitespaceSeparator(value) {
  const whitespace = String(value || '');
  if (!whitespace) return '';
  const newlineCount = (whitespace.match(/\n/g) || []).length;
  if (newlineCount >= 2) return '\n\n';
  if (newlineCount === 1) return '\n';
  return ' ';
}

// 作用: 在完整 Markdown 块边界内拆分回复；输入为正文、限制和计量单位；输出为非空且语法完整的消息数组。
function splitMarkdownReply(markdown, limit, { unit = 'characters' } = {}) {
  const value = String(markdown || '');
  if (!value.trim()) return [];
  if (measureReplyText(value, unit) <= limit) return [value];
  const blocks = collectMarkdownBlocks(value);
  const chunks = [];
  let current = '';
  let pendingSeparator = '';
  // 作用: 提交当前回复片段并清空缓冲；输入为空；输出为更新后的消息数组。
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current);
    current = '';
  };
  blocks.forEach((block) => {
    if (/^\s+$/u.test(block)) {
      const candidate = `${current}${block}`;
      if (current && measureReplyText(candidate, unit) <= limit) {
        current = candidate;
        return;
      }
      if (current) {
        const available = limit - measureReplyText(current, unit);
        if (available > 0) {
          const separatorParts = splitTextExactly(block, available, unit);
          current += separatorParts.shift() || '';
          pendingSeparator += separatorParts.join('');
        } else {
          pendingSeparator += block;
        }
        pushCurrent();
        return;
      }
      pendingSeparator += block;
      return;
    }

    let blockWithSeparator = block;
    if (pendingSeparator) {
      const losslessCandidate = `${pendingSeparator}${block}`;
      if (measureReplyText(losslessCandidate, unit) <= limit) {
        blockWithSeparator = losslessCandidate;
      } else {
        const collapsedSeparator = collapseWhitespaceSeparator(pendingSeparator);
        const collapsedCandidate = `${collapsedSeparator}${block}`;
        if (measureReplyText(collapsedCandidate, unit) <= limit) {
          blockWithSeparator = collapsedCandidate;
        }
      }
      pendingSeparator = '';
    }

    const candidate = `${current}${blockWithSeparator}`;
    if (measureReplyText(candidate, unit) <= limit) {
      current = candidate;
      return;
    }
    pushCurrent();
    const parts = measureReplyText(blockWithSeparator, unit) <= limit
      ? [blockWithSeparator]
      : splitOversizedMarkdownBlock(blockWithSeparator, limit, unit);
    let pendingPartSeparator = '';
    parts.forEach((part) => {
      if (measureReplyText(part, unit) > limit) {
        throw new RangeError('MARKDOWN_CHUNK_TOO_LARGE');
      }
      if (/^\s+$/u.test(part)) {
        const whitespaceCandidate = `${current}${part}`;
        if (current && measureReplyText(whitespaceCandidate, unit) <= limit) {
          current = whitespaceCandidate;
          return;
        }
        if (current) pushCurrent();
        pendingPartSeparator += part;
        return;
      }

      let visiblePart = part;
      if (pendingPartSeparator) {
        const losslessPart = `${pendingPartSeparator}${part}`;
        if (measureReplyText(losslessPart, unit) <= limit) {
          visiblePart = losslessPart;
        } else {
          const collapsedPart = `${collapseWhitespaceSeparator(pendingPartSeparator)}${part}`;
          if (measureReplyText(collapsedPart, unit) <= limit) {
            visiblePart = collapsedPart;
          }
        }
        pendingPartSeparator = '';
      }
      if (current) pushCurrent();
      current = visiblePart;
    });
    pendingSeparator += pendingPartSeparator;
  });
  pushCurrent();
  return chunks;
}

module.exports = {
  buildSafeStreamPreview,
  createReplyRenderPlan,
  renderReplyPlan,
  splitMarkdownReply
};
