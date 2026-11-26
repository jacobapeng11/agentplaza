const CREDENTIAL_KEY_SOURCE = [
  'authorization',
  'auth',
  'credential',
  'password',
  'passwd',
  'client[\\s_-]*secret',
  'api[\\s_-]*key',
  'access[\\s_-]*token',
  'refresh[\\s_-]*token',
  'id[\\s_-]*token',
  'csrf(?:[\\s_-]*token)?',
  'wecom[\\s_-]*media[\\s_-]*id',
  'media[\\s_-]*id',
  'aes[\\s_-]*key',
  'set[\\s_-]*cookie',
  'session(?:[\\s_-]*id)?',
  'signature',
  'secret',
  'token',
  'cookie',
  'jwt',
  'sig'
].join('|');

/**
 * 构造忽略引号转义符的凭据扫描视图。
 * 输入: 任意待检查文本。
 * 输出: 去掉引号前反斜杠的等价扫描文本，以及扫描下标到原文下标的映射。
 */
function buildCredentialScanView(value = '') {
  const source = String(value || '');
  let text = '';
  const originalIndexes = [];
  for (let cursor = 0; cursor < source.length;) {
    if (source[cursor] === '\\') {
      let quoteIndex = cursor;
      while (source[quoteIndex] === '\\') quoteIndex += 1;
      if (source[quoteIndex] === '"' || source[quoteIndex] === "'") {
        text += source[quoteIndex];
        originalIndexes.push(quoteIndex);
        cursor = quoteIndex + 1;
        continue;
      }
    }
    text += source[cursor];
    originalIndexes.push(cursor);
    cursor += 1;
  }
  originalIndexes.push(source.length);
  return { source, text, originalIndexes };
}

/**
 * 将扫描视图中的半开区间映射回原文。
 * 输入: 扫描区间、原文下标映射及是否包含开头引号前的转义符。
 * 输出: 原文中的 start/end 半开区间。
 */
function mapScanRangeToSource(start, end, originalIndexes, source, includeLeadingEscapes = false) {
  let sourceStart = originalIndexes[start] ?? source.length;
  const sourceEnd = originalIndexes[end] ?? source.length;
  if (includeLeadingEscapes) {
    while (sourceStart > 0 && source[sourceStart - 1] === '\\') sourceStart -= 1;
  }
  return { start: sourceStart, end: sourceEnd };
}

/**
 * 收集文本中的 Bearer 与键值凭据区间。
 * 输入: 任意字符串，支持普通、单/双引号及反斜杠转义形式。
 * 输出: 不重叠的凭据匹配数组，包含完整区间和值区间。
 */
function collectCredentialMatches(value = '') {
  const { source, text, originalIndexes } = buildCredentialScanView(value);
  const matches = [];

  // 作用: 记录单个正则匹配；输入为 RegExp match、凭据类型和值分组；输出为 matches 原地追加且无返回值。
  const recordMatch = (match, kind, valueGroup) => {
    const fullScanRange = match.indices?.[0];
    const valueScanRange = match.indices?.[valueGroup];
    if (!fullScanRange || !valueScanRange) return;
    const fullRange = mapScanRangeToSource(
      fullScanRange[0],
      fullScanRange[1],
      originalIndexes,
      source,
      true
    );
    const valueRange = mapScanRangeToSource(
      valueScanRange[0],
      valueScanRange[1],
      originalIndexes,
      source
    );
    if (matches.some((item) => fullRange.start < item.fullEnd && fullRange.end > item.fullStart)) return;
    matches.push({
      kind,
      fullStart: fullRange.start,
      fullEnd: fullRange.end,
      valueStart: valueRange.start,
      valueEnd: valueRange.end
    });
  };

  const patterns = [
    {
      kind: 'bearer',
      valueGroup: 2,
      regex: new RegExp('\\b(?:authorization\\s*:\\s*)?bearer\\s+(["\\\'])([^\\r\\n]*?)\\1', 'gdi')
    },
    {
      kind: 'bearer',
      valueGroup: 1,
      regex: /\b(?:authorization\s*:\s*)?bearer\s+([^\s,;]+)/gdi
    },
    {
      kind: 'credential',
      valueGroup: 4,
      regex: new RegExp(`(["']?)\\b(${CREDENTIAL_KEY_SOURCE})\\b\\1\\s*[:=]\\s*(["'])([^\\r\\n]*?)\\3`, 'gdi')
    },
    {
      kind: 'credential',
      valueGroup: 3,
      regex: new RegExp(`(["']?)\\b(${CREDENTIAL_KEY_SOURCE})\\b\\1\\s*[:=]\\s*([^\\s,;{}\\[\\]"']+)`, 'gdi')
    }
  ];
  patterns.forEach(({ regex, kind, valueGroup }) => {
    let match = regex.exec(text);
    while (match) {
      recordMatch(match, kind, valueGroup);
      match = regex.exec(text);
    }
  });
  return matches.sort((left, right) => left.fullStart - right.fullStart);
}

/**
 * 判断文本是否包含已知凭据表达式。
 * 输入: 任意文本。
 * 输出: 命中 Bearer 或统一凭据词表时返回 true。
 */
function containsCredentialText(value = '') {
  return collectCredentialMatches(value).length > 0;
}

/**
 * 稳定脱敏文本中的已知凭据。
 * 输入: 原文及是否保留键名、Bearer/普通凭据替代文本。
 * 输出: 不含原凭据值且保持其余文本顺序的字符串。
 */
function redactCredentialText(value = '', {
  preserveKey = true,
  credentialReplacement = '[REDACTED]',
  bearerReplacement = preserveKey ? '[REDACTED]' : '[REDACTED_AUTH]'
} = {}) {
  const source = String(value || '');
  const replacements = collectCredentialMatches(source).map((match) => ({
    start: preserveKey ? match.valueStart : match.fullStart,
    end: preserveKey ? match.valueEnd : match.fullEnd,
    value: match.kind === 'bearer' ? bearerReplacement : credentialReplacement
  }));
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((output, item) => (
      `${output.slice(0, item.start)}${item.value}${output.slice(item.end)}`
    ), source);
}

module.exports = {
  containsCredentialText,
  redactCredentialText
};
