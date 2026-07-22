import React, { useMemo, useState, useRef, useEffect, useImperativeHandle, memo, useCallback } from 'react';
import { Node } from 'reactflow';
import { Send, Loader2, ChevronDown, ChevronUp, MessageSquare, User, Bot, X, Brain, Link2, Image as ImageIcon, ArrowRight, Ban, FileSpreadsheet, Table2, GitBranch, Zap, Sparkles, FileText } from 'lucide-react';
import { NodeType, NodeData } from '../types';
import axios from 'axios';
import { uploadImage } from '../services/aitop';
import {
  getStoredUser,
  listChatHistory,
  saveChatHistory,
  getChatHistory,
  deleteChatHistory,
  resolveDisplayMediaUrl,
  isFlowgenProtectedAssetFileUrl,
} from '../services/flowgenApi';
import {
  type ChatStorageScope,
  chatSessionsListStorageKey,
  chatLocalHistoryStorageKey,
  resolveChatStorageScope,
} from '../utils/chatStorageScope';
import {
  buildProjectSkillAitopTip,
  buildProjectSkillBlock,
  buildCanvasWelcomeChatContent,
  isProjectSkillActive,
  type ProjectSkillConfig,
} from '../utils/projectSkill';
import { validateStoryboardTableSpawn } from '../utils/storyboardTableSpawn';
import { DIRECTOR_STORYBOARD_ADVANCED_MD, DIRECTOR_STORYBOARD_CORE_MD } from '../utils/storyboardPresets';
import { resolveNodeSelectionPreviewUrl } from '../utils/nodeDetailsPreview';
import type { ProjectAssetLabelRow } from '../utils/referenceImageSlotLabels';
import { buildNodePromptUpdatePatch } from '../utils/promptMediaRefs';
import { profileSync } from '../utils/runtimeProfile';
import { isAssistantIdentityQuestion, isNonSearchableChatUtterance, resolveWebSearchProbeQuery } from '../utils/webSearchProbe';
import {
  ASSISTANT_MARKER_THINKING,
  ASSISTANT_MARKER_WEB_SEARCH,
  composeAssistantMessage,
  isLikelyRawWebSearchDump,
  isLikelyTooShortMainAnswer,
  localizeWebSearchProcessForDisplay,
  localizeThinkingProcessForDisplay,
  augmentWebSearchWithProbeQuery,
  consolidateWebSearchDumpContent,
  splitWebSearchForDisplay,
  mergeWithWebSearchProcess,
  guardAssistantReplyContent,
  assistantReplyHasVisibleMain,
  recoverAssistantReplyFromRaw,
  flattenAssistantSectionsWhenProcessDisabled,
  isDetailRichUserQuestion,
  needsWebSearchSynthesisPass,
  prepareWebSearchFirstPassContent,
  normalizeAssistantStream,
  parseAssistantMessage,
  resolveAssistantDisplaySections,
  stripAssistantProcessForHistory,
  isInternalPromptLeakQuery,
  isInternalPromptBoilerplateLine,
  stripLeakedSearchBlocks,
  stripInternalPromptBoilerplate,
  sanitizeWebSearchProcessText,
  sanitizeAssistantDisplayText,
  isLikelyMainOnlySearchDump,
} from '../utils/assistantMessageLayout';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import {
  AITOP_LLM_API,
  AITOP_CHAT_MODELS,
  QWEN_CHAT_UI_ID,
  buildChatAiModelsForUi,
  chatModelDisplayLabel,
  chatModelFallbackChain,
  getAitopChatModel,
  isAitopLlmUiModel,
  isQwenChatUiModel,
  normalizeChatModelId,
} from '../utils/aitopChatModels';
import { logChatLlmPreload, isChatQwenDebugEnabled } from '../utils/chatRequestLog';

// Qwen 经同源代理（与 1225 版一致：统一 /api/v1 → models.fangte.com/v1/chat/completions）
const QWEN_API_CONFIG = {
  URL: '/api/v1/chat/completions',
  API_KEY: '0fd502c3-7d1b-43d3-9eb6-4e91918af979',
  MODEL_NAME: 'Qwen3-VL-235B-A22B-Instruct',
  MAX_TOKENS: 204800,
  /** 普通闲聊默认上限 */
  MAX_TOKENS_CHAT: 8192,
  /** 项目 Skill / 长剧本 / fallback 分镜生成 */
  MAX_TOKENS_SKILL_CHAT: 32_768,
};

/** @deprecated 使用 AITOP_LLM_API */
const GEMINI_API_CONFIG = {
  BASE_URL: AITOP_LLM_API.BASE_URL,
  URL: AITOP_LLM_API.URL,
  API_KEY: AITOP_LLM_API.API_KEY,
  MODEL_NAME: AITOP_CHAT_MODELS[0].apiModelName,
  USER_ID: AITOP_LLM_API.USER_ID,
};

/** @deprecated 使用 AITOP_LLM_API + getAitopChatModel */
const CLAUDE_API_CONFIG = {
  BASE_URL: AITOP_LLM_API.BASE_URL,
  URL: AITOP_LLM_API.URL,
  API_KEY: AITOP_LLM_API.API_KEY,
  MODEL_NAME: AITOP_CHAT_MODELS[1].apiModelName,
  USER_ID: AITOP_LLM_API.USER_ID,
};

// ????
const PROXIES = {
  http: null,
  https: null
};

type ThinkingMode = 'off' | 'light' | 'deep';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string; // ????????????????
  imageUrls?: string[]; // ??????
  timestamp: Date;
  /** ?????????????? content ??????content ????? */
  tableRows?: string[][];
  /** ????????????????????? */
  isStreaming?: boolean;
}

/** ??FlowEditor / Sidebar ??????? patch??????????? patch */
export type UpdateSelectedNodesDataFn = (
  newData: Partial<NodeData> | ((node: Node) => Partial<NodeData>)
) => void;

/** 分镜表右键批量生成下游节点 */
export type SpawnStoryboardNodesFromTableFn = (payload: {
  rows: string[][];
  templateNodeId: string;
}) => { ok: true; created: number } | { ok: false; error: string };

/** ??????????localStorage ??????????? */
export type PersistedCanvasChatV1 = {
  v: 1;
  chatId: string;
  modelId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
      imageUrl?: string;
      imageUrls?: string[];
      tableRows?: string[][];
  }>;
};

interface ChatPanelProps {
  selectedNode: Node | undefined | null;
  selectedNodes: Node[];
  /** 从画布实时读取选中节点（避免点击聊天区后 props 快照为空） */
  getCanvasSelectedNodes?: () => Node[];
  /** 画布全部节点（无选中时单资产模板回退） */
  getCanvasNodes?: () => Node[];
  /** 工作区项目 id（与 serverProjectId 一致，用于资产库 URL 校验） */
  workspaceProjectId?: string;
  updateSelectedNodesData: UpdateSelectedNodesDataFn;
  /** 分镜表生成：按节点 id 读取画布上最新 data（避免侧栏选中快照过期） */
  getLiveTemplateData?: (templateNodeId: string) => NodeData | undefined;
  onSpawnStoryboardNodesFromTable?: SpawnStoryboardNodesFromTableFn;
  /**
   * ???? /api/v1/llm/see ??? id ???????????/???????
   * ???????USER_ID_??String??? JSDoc ?????????????
   */
  chatIdUserTag?: string;
  /** ?????? chatId ?????????????????????????*/
  onChatIdChange?: (chatId: string) => void;
  /** ??????????????????????????? */
  onChatActivity?: (chatId: string, meta: { modelId: string }) => void;
  /** ?? localStorage?server ?????????? onCanvasChatSnapshot ?????????? */
  canvasChatPersistence?: 'local' | 'server';
  /** ??????flowgen:chat:canvas-session ???????????? projectId??*/
  canvasChatStorageKey?: string;
  /** ?????????????????PersistedCanvasChatV1 ????*/
  initialCanvasChatV1?: PersistedCanvasChatV1 | null;
  /** canvasChatPersistence=server ???????? workspace */
  onCanvasChatSnapshot?: (body: PersistedCanvasChatV1) => void;
  /** ???? / ??????? + ???? */
  chatStorageScope?: ChatStorageScope;
  /** 项目级 Skill（侧边栏 Chat 发送时注入 API，不在 UI 展示正文） */
  projectSkill?: ProjectSkillConfig | null;
  /** 资产库行（Seedance 参考生预览按 @ 与标签解析，避免误拖主图） */
  projectAssetLabelRows?: ProjectAssetLabelRow[];
}

export interface ChatPanelHandle {
  resetConversation: (nextChatId?: string) => void;
  setChatId: (nextChatId: string) => void;
  getChatId: () => string;
  setMessages: (messages: ChatMessage[]) => void;
  getMessages: () => ChatMessage[];
}

type StoredSession = {
  chatId: string;
  title?: string;
  modelId: string;
  updatedAt: number;
};

type SessionExportMenuState = {
  x: number;
  y: number;
  session: StoredSession;
} | null;

type LocalHistoryMap = Record<
  string,
  {
    modelId: string;
    updatedAt: number;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
      imageUrl?: string;
      imageUrls?: string[];
      tableRows?: string[][];
    }>;
  }
>;

type CompactChatBackupV1 = {
  v: 1;
  kind: 'flowgen-chat-backup';
  exportedAt: string;
  chatId: string;
  modelId: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
};

const CHAT_USER_TAG_KEY = 'flowgen:chat:userTag';
const CHAT_RENDER_PAGE_SIZE = 80;

function loadStoredSessions(scope: ChatStorageScope): StoredSession[] {
  if (typeof window === 'undefined') return [];
  const key = chatSessionsListStorageKey(scope);
  const raw = safeJsonParse<Array<Partial<StoredSession> & { updatedAt?: unknown }>>(
    localStorage.getItem(key),
    []
  );
  return raw
    .map((s) => {
      const chatId = String(s?.chatId || '').trim();
      if (!chatId) return null;
      const modelId = normalizeModelId(String(s?.modelId || 'qwen'));
      const title = typeof s?.title === 'string' ? s.title : '';
      const updatedAt = normalizeSessionUpdatedAt(s?.updatedAt);
      return {
        chatId,
        modelId,
        updatedAt,
        ...(title ? { title } : {}),
      } satisfies StoredSession;
    })
    .filter((s): s is StoredSession => !!s);
}

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function normalizeSessionUpdatedAt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(v);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return Date.now();
}

/** ???CSV ???????????? */
function simpleCsvSplitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function padRowsToMatrix(rows: string[][]): string[][] {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => [...r, ...Array(Math.max(0, w - r.length)).fill('')]);
}

/**
 * ????????????Markdown ????TSV?????????????????????????? */
function extractRowsFromHtmlTable(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll('th, td');
    if (cells.length === 0) return;
    rows.push(Array.from(cells, (cell) => (cell.textContent || '').replace(/\r/g, '').trim()));
  });
  return rows;
}

function findChatTableFromContext(target: HTMLElement, selection: Selection | null): HTMLTableElement | null {
  const fromTarget = target.closest('table');
  if (fromTarget) return fromTarget;
  if (!selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  for (const node of [anchor, focus]) {
    if (!node) continue;
    const el = node instanceof Element ? node : node.parentElement;
    const table = el?.closest('table');
    if (table) return table;
  }
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const ancestorEl = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  return ancestorEl?.closest('table') ?? null;
}

function parseSelectionToRows(text: string): string[][] {
  const raw = (text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [['']];

  const lines = raw.split('\n');
  const trimmedPreview = lines.filter((l) => l.trim().length > 0);
  if (trimmedPreview.length === 0) return [['']];

  // Markdown ??
  const pipeLines = lines.filter((l) => l.includes('|'));
  if (pipeLines.length >= 2) {
    const rows: string[][] = [];
    for (const line of pipeLines) {
      const t = line.trim();
      if (!t.includes('|')) continue;
      if (/^[\|\s:\-]+$/.test(t)) continue;
      const cells = t
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    }
    if (rows.length >= 1) return rows;
  }

  const tabHeavy = lines.filter((l) => l.includes('\t')).length;
  if (tabHeavy >= Math.max(1, Math.ceil(lines.length * 0.45))) {
    return lines.map((l) => l.split('\t').map((c) => c.trimEnd().trim()));
  }

  const commaCounts = lines.map((l) => (l.match(/,/g) || []).length);
  const maxComma = Math.max(0, ...commaCounts);
  if (maxComma >= 1 && lines.length > 0 && commaCounts.every((c) => c === maxComma)) {
    return lines.map((l) => simpleCsvSplitLine(l));
  }

  return lines.map((l) => [l]);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportRowsAsCsv(rows: string[][], baseName: string) {
  const matrix = padRowsToMatrix(rows);
  const body = matrix.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(`${baseName}.csv`, blob);
}

async function exportRowsAsXlsx(rows: string[][], baseName: string) {
  const XLSX = await import('xlsx');
  const matrix = padRowsToMatrix(rows);
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}

/** Markdown ??????| --- | :---: | ??*/
function isMarkdownTableSeparatorCells(cells: string[]): boolean {
  if (!cells.length) return true;
  return cells.every((c) => {
    const s = c.trim();
    if (!s) return true;
    return /^:?-{2,}:?$/.test(s);
  });
}

/** ????Markdown ????????????????????????????<br> ?? */
function parseMarkdownPipeTableLines(blockLines: string[]): string[][] | null {
  const rows: string[][] = [];
  for (const raw of blockLines) {
    const t = raw.trim();
    if (!t.includes('|')) continue;
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => !c)) continue;
    if (isMarkdownTableSeparatorCells(cells)) continue;
    rows.push(cells);
  }
  return rows.length >= 2 && rows[0].length >= 2 ? rows : null;
}

/** ??????????????+????? |---| ????*/
function parseMarkdownPipeTableLinesRelaxed(blockLines: string[]): string[][] | null {
  const rows: string[][] = [];
  for (const raw of blockLines) {
    const t = raw.trim();
    if (!t.includes('|')) continue;
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => !c)) continue;
    if (isMarkdownTableSeparatorCells(cells)) continue;
    rows.push(cells);
  }
  return rows.length >= 1 && (rows[0]?.length ?? 0) >= 2 ? rows : null;
}

function splitPipeTableRowCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.includes('|')) return null;
  const cells = t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  if (cells.every((c) => !c)) return null;
  if (isMarkdownTableSeparatorCells(cells)) return null;
  if (cells.length >= 3) return cells;
  if (cells.length >= 2 && /^(ep\d+_|S\d+|sc\d+)/i.test(cells[0])) return cells;
  if (cells.length >= 2 && (t.startsWith('|') || t.endsWith('|'))) return cells;
  return null;
}

function isPipeTableMetadataLine(line: string): boolean {
  const t = line.trim();
  if (!t || /^【续】/.test(t)) return false;
  return /^【[^】]+】/.test(t);
}

function isPipeTableSectionBreak(line: string): boolean {
  return /^【续】/.test(line.trim());
}

/** Qwen 等：单行 pipe 字段 + 【音效】等 metadata 穿插的多行分镜 */
function extractLoosePipeDelimitedTable(
  text: string
): { matrix: string[][]; before: string; after: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (splitPipeTableRowCells(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const matrix: string[][] = [];
  let end = start;
  let sawRow = false;

  while (end < lines.length) {
    const raw = lines[end];
    const t = raw.trim();
    if (!t) {
      end++;
      continue;
    }
    if (t.startsWith('```')) break;
    if (isPipeTableSectionBreak(t) && sawRow) break;

    const cells = splitPipeTableRowCells(raw);
    if (cells) {
      matrix.push(cells);
      sawRow = true;
      end++;
      continue;
    }
    if (isPipeTableMetadataLine(t) && matrix.length) {
      const last = matrix[matrix.length - 1];
      last[last.length - 1] = `${last[last.length - 1]}\n${t}`.trim();
      end++;
      continue;
    }
    if (sawRow) break;
    end++;
  }

  if (matrix.length < 1 || (matrix[0]?.length ?? 0) < 2) return null;
  if (matrix.length < 2 && (matrix[0]?.length ?? 0) < 3) return null;

  return {
    matrix: padRowsToMatrix(matrix),
    before: lines.slice(0, start).join('\n').trimEnd(),
    after: lines.slice(end).join('\n').trimStart(),
  };
}

function extractConsecutivePipeBlock(
  text: string
): { matrix: string[][]; before: string; after: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('```')) continue;
    if (t.includes('|') && t.split('|').filter((x) => x.trim().length > 0).length >= 2) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = start;
  const block: string[] = [];
  while (end < lines.length) {
    const raw = lines[end];
    const t = raw.trim();
    if (!t) break;
    if (t.startsWith('```')) break;
    if (t.includes('|')) {
      block.push(raw);
      end++;
      continue;
    }
    break;
  }
  const relaxed = parseMarkdownPipeTableLinesRelaxed(block);
  if (!relaxed) return null;
  return {
    matrix: padRowsToMatrix(relaxed),
    before: lines.slice(0, start).join('\n').trimEnd(),
    after: lines.slice(end).join('\n').trimStart(),
  };
}

function extractNextPipeTable(
  text: string
): { matrix: string[][]; before: string; after: string } | null {
  const strict = extractEmbeddedPipeTable(text);
  if (strict) return { ...strict, matrix: padRowsToMatrix(strict.matrix) };
  return extractConsecutivePipeBlock(text) ?? extractLoosePipeDelimitedTable(text);
}

/** ???????? HTML ???Gemini ??????<table>??*/
function extractEmbeddedHtmlTable(text: string): { matrix: string[][]; before: string; after: string } | null {
  if (typeof DOMParser === 'undefined') return null;
  const match = text.match(/<table[\s\S]*?<\/table>/i);
  if (!match) return null;
  try {
    const doc = new DOMParser().parseFromString(match[0], 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const matrix = Array.from(table.querySelectorAll('tr'))
      .map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((cell) => (cell.textContent || '').trim())
      )
      .filter((row) => row.some((c) => c.length > 0));
    if (matrix.length < 1 || (matrix[0]?.length ?? 0) < 2) return null;
    const idx = text.indexOf(match[0]);
    return {
      matrix: padRowsToMatrix(matrix),
      before: text.slice(0, idx).trimEnd(),
      after: text.slice(idx + match[0].length).trimStart(),
    };
  } catch {
    return null;
  }
}

/** ???????????????Gemini / Claude / Qwen ????*/
function finalizeAssistantMessageContent(rawText: string): { content: string; tableRows?: string[][] } {
  const text = (rawText || '').replace(/\r\n/g, '\n');
  const sections = parseAssistantMessage(text);
  const mainPart = sections.main;
  const processSuffix = [
    sections.webSearch ? `${ASSISTANT_MARKER_WEB_SEARCH}\n${sections.webSearch}` : '',
    sections.thinking ? `${ASSISTANT_MARKER_THINKING}\n${sections.thinking}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const thinkSuffix = processSuffix ? `\n\n${processSuffix}` : '';

  const tableSegCount = segmentMessageByPipeTables(mainPart).filter((s) => s.kind === 'table').length;
  if (tableSegCount >= 2) {
    return { content: (mainPart + thinkSuffix).trimEnd() };
  }

  const pipeEx = extractNextPipeTable(mainPart);
  if (pipeEx?.after.trim()) {
    const afterTables = segmentMessageByPipeTables(pipeEx.after).filter((s) => s.kind === 'table').length;
    if (afterTables > 0) {
      return { content: (mainPart + thinkSuffix).trimEnd() };
    }
  }

  const htmlEx = extractEmbeddedHtmlTable(mainPart);
  const extraction = pipeEx || htmlEx;
  if (!extraction) {
    return { content: text };
  }

  const displayMain =
    (extraction.before.trim() ? `${extraction.before.trim()}\n\n` : '') +
    (extraction.after.trim() ? extraction.after.trim() : '【分镜表格见下方】');
  return {
    content: (displayMain + thinkSuffix).trimEnd(),
    tableRows: extraction.matrix,
  };
}

function normalizeLlmTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: string }).text ?? '');
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as { text?: string }).text ?? '');
  }
  return String(content ?? '');
}

/** ?????????????/ ???????????? Markdown ????*/
type ChatContentSegment = { kind: 'text'; text: string } | { kind: 'table'; matrix: string[][] };

function segmentMessageByPipeTables(text: string): ChatContentSegment[] {
  const segs: ChatContentSegment[] = [];
  let rest = (text || '').replace(/\r\n/g, '\n');
  for (let guard = 0; guard < 200 && rest.length; guard++) {
    const ex = extractNextPipeTable(rest);
    if (!ex) {
      segs.push({ kind: 'text', text: rest });
      break;
    }
    if (ex.before.trim()) segs.push({ kind: 'text', text: ex.before });
    segs.push({ kind: 'table', matrix: ex.matrix });
    rest = ex.after;
    if (!rest.trim()) break;
  }
  return segs.length ? segs : [{ kind: 'text', text: text || '' }];
}

/** ????????????Markdown ??????????????????????????*/
function extractEmbeddedPipeTable(text: string): { matrix: string[][]; before: string; after: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('```')) continue;
    if (t.includes('|') && t.split('|').filter((x) => x.trim().length > 0).length >= 2) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = start;
  const block: string[] = [];
  while (end < lines.length) {
    const raw = lines[end];
    const t = raw.trim();
    if (!t) break;
    if (t.startsWith('```')) break;
    if (t.includes('|')) {
      block.push(raw);
      end++;
      continue;
    }
    break;
  }
  const matrix = parseMarkdownPipeTableLines(block);
  if (!matrix) return null;
  const before = lines.slice(0, start).join('\n').trimEnd();
  const after = lines.slice(end).join('\n').trimStart();
  return { matrix, before, after };
}

function normalizeTableCellBrTags(cell: string): string {
  return cell.replace(/<br\s*\/?>/gi, '\n');
}

function ChatTableHtml({ rows }: { rows: string[][] }) {
  const matrix = padRowsToMatrix(rows);
  return (
    <div className="overflow-x-auto max-w-full my-1 rounded-lg border border-gray-600/50 bg-gray-950/60 shadow-inner select-text cursor-text">
      <table className="border-collapse min-w-[min(100%,42rem)] select-text">
        <tbody>
          {matrix.map((r, ri) => (
            <tr key={ri} className={ri === 0 ? 'bg-gray-800/90 font-semibold text-brand-100' : 'hover:bg-gray-800/40'}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className="border border-gray-600/70 px-2 py-1.5 text-[11px] sm:text-xs align-top text-gray-100 max-w-[24rem] select-text"
                >
                  <span className="whitespace-pre-wrap break-words select-text">{normalizeTableCellBrTags(c)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

                // ??????
const AI_MODELS = buildChatAiModelsForUi();

/** ????????setState ???????????? OOM / ????*/
const CHAT_STREAM_UI_INTERVAL_MS = 30;

/** AITop100 ??????/???????? */
const AITOP_LLM_FETCH_TIMEOUT_MS = 45_000;
/** ??????????????????????????????????*/
const AITOP_LLM_STREAM_IDLE_TIMEOUT_MS = 60_000;
/** Qwen axios 超时（与 test.py timeout=600 对齐，VL 模型首包/生图分析可能较慢） */
const QWEN_AXIOS_TIMEOUT_MS = 600_000;
const QWEN_AXIOS_TIMEOUT_LIGHT_MS = 600_000;
/** Gemini ????????????????Claude?????????? */
const GEMINI_FETCH_TIMEOUT_MS_NORMAL = 90_000;
/** Claude ?????? Gemini???????? */
const CLAUDE_FETCH_TIMEOUT_MS_NORMAL = 90_000;
const GEMINI_FETCH_TIMEOUT_MS_WEB = 90_000;
/** ?????????????????????????????? */
const AITOP_SUMMARIZE_FETCH_TIMEOUT_MS = 90_000;
const AITOP_SUMMARIZE_STREAM_IDLE_TIMEOUT_MS = 90_000;
/** 思考模式流式空闲超时：复杂推理（物理题/数学证明）首 token 可能较慢，放宽到 180s 避免误判超时 */
const AITOP_LLM_STREAM_IDLE_DEEP_MS = 180_000;
/** ????????????????????????????????????? fallback ??*/
const FAST_SWITCH_ON_UPSTREAM_FALLBACK = true;
/** ???????????? 1 ????? Claude/Gemini/Qwen ??? */
const PRIMARY_SAME_MODEL_RETRY_ONCE = true;
/** ?????????????????????????? */
const DEGRADED_FETCH_TIMEOUT_MS = 12_000;
const DEGRADED_STREAM_IDLE_TIMEOUT_MS = 20_000;
/** Skill + 长剧本等大 payload 时的 AiTop 超时上限（勿与 SUMMARIZE 90s 混用） */
const AITOP_HEAVY_PAYLOAD_FETCH_CAP_MS = 120_000;
const AITOP_HEAVY_PAYLOAD_STREAM_IDLE_CAP_MS = 240_000;

/** 长输出自动续写：已输出超过此字数才触发（借鉴 grok-build 的错误分类思路） */
const AITOP_CONTINUATION_MIN_CHARS = 1000;
/** 自动续写最大轮数（防止无限循环和费用失控；3 轮覆盖约 4.8 万字） */
const MAX_AITOP_CONTINUATION_ROUNDS = 3;
/** 续写 prompt 中携带的已输出尾部字数（借鉴 grok-build truncate_middle_words 保留尾部上下文） */
const AITOP_CONTINUATION_TAIL_CHARS = 1500;
/** 续写前等待毫秒数（借鉴 grok-build 指数退避思路，给上游恢复窗口） */
const AITOP_CONTINUATION_DELAY_MS = 1500;
/** 空响应(0字)同模型重试次数上限（借鉴 grok-build AttemptOutcome::Empty） */
const AITOP_EMPTY_RESPONSE_RETRY_MAX = 1;

function resolveAitopPayloadHeavyMultiplier(payloadCharLen: number): number {
  if (payloadCharLen >= 30_000) return 2.5;
  if (payloadCharLen >= 15_000) return 2;
  if (payloadCharLen >= 8_000) return 1.5;
  return 1;
}

function resolveAitopFetchTimeoutMs(
  model: 'gemini' | 'claude',
  opts: {
    useDegraded: boolean;
    isSummarize: boolean;
    effectiveWebSearch: boolean;
    payloadCharLen?: number;
  }
): number {
  if (opts.useDegraded) return DEGRADED_FETCH_TIMEOUT_MS;
  if (opts.isSummarize) return AITOP_SUMMARIZE_FETCH_TIMEOUT_MS;
  if (opts.effectiveWebSearch) return GEMINI_FETCH_TIMEOUT_MS_WEB;
  const base =
    model === 'claude' ? CLAUDE_FETCH_TIMEOUT_MS_NORMAL : GEMINI_FETCH_TIMEOUT_MS_NORMAL;
  const mult = resolveAitopPayloadHeavyMultiplier(opts.payloadCharLen ?? 0);
  if (mult <= 1) return base;
  return Math.min(Math.round(base * mult), AITOP_HEAVY_PAYLOAD_FETCH_CAP_MS);
}

function resolveAitopStreamIdleTimeoutMs(
  thinkingMode: ThinkingMode,
  opts: {
    useDegraded: boolean;
    isSummarize: boolean;
    effectiveWebSearch: boolean;
    payloadCharLen?: number;
  }
): number {
  if (opts.useDegraded) return DEGRADED_STREAM_IDLE_TIMEOUT_MS;
  if (opts.isSummarize || opts.effectiveWebSearch) return AITOP_SUMMARIZE_STREAM_IDLE_TIMEOUT_MS;
  let base =
    thinkingMode === 'deep' ? AITOP_LLM_STREAM_IDLE_DEEP_MS : AITOP_LLM_STREAM_IDLE_TIMEOUT_MS;
  const mult = resolveAitopPayloadHeavyMultiplier(opts.payloadCharLen ?? 0);
  if (mult <= 1) return base;
  return Math.min(Math.round(base * mult), AITOP_HEAVY_PAYLOAD_STREAM_IDLE_CAP_MS);
}

function resolveQwenMaxTokens(opts: {
  lightweight: boolean;
  hasImages: boolean;
  userTextLen: number;
  skillActive: boolean;
  fromFallback?: boolean;
}): number {
  if (opts.lightweight) return 2048;
  if (opts.hasImages) return QWEN_API_CONFIG.MAX_TOKENS;
  if (opts.fromFallback || opts.skillActive || opts.userTextLen >= 3000) {
    return QWEN_API_CONFIG.MAX_TOKENS_SKILL_CHAT;
  }
  return QWEN_API_CONFIG.MAX_TOKENS_CHAT;
}

function buildFallbackSwitchNotice(
  fromLabel: string,
  toLabel: string,
  partialChars?: number,
  reasonShort?: string
): string {
  let msg = `⚠️ **${fromLabel}** 回复未完成，正在改用 **${toLabel}** 继续生成完整回答。`;
  if (partialChars && partialChars > 80) {
    msg += `\n\n${fromLabel} 已输出约 **${partialChars}** 字（见上方保留内容）。`;
  }
  if (reasonShort?.trim()) {
    msg += `\n\n**切换原因：** ${reasonShort.trim()}`;
  }
  return msg;
}

function isIncompleteAttemptMessage(m: ChatMessage): boolean {
  return m.role === 'assistant' && m.id.startsWith('incomplete-attempt-');
}

function extractStreamErrorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 280);
  return error.message
    .replace(/^\*\*❌[^\n]*\*\*\n+/i, '')
    .replace(/\*\*对话ID：\*\*[^\n]+/g, '')
    .replace(/\*\*请求ID：\*\*[^\n]+/g, '')
    .trim()
    .slice(0, 280);
}

/** 流式中断：保留已输出正文并标记未完成，随后继续 fallback */
function preserveIncompleteStreamOnError(opts: {
  modelLabel: string;
  modelSlug: string;
  fullContent: string;
  fullReasoning: string;
  collectReasoning: boolean;
  allowWebSearchExtractFromMain?: boolean;
  webSearchEnabled?: boolean;
  thinkingEnabled?: boolean;
  webSearchQuery?: string;
  userQuestion: string;
  assistantMessageId: string;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  error: unknown;
}): number {
  const partialLen = (opts.fullContent || '').trim().length;
  if (partialLen === 0) {
    opts.setMessages((prev) => prev.filter((m) => m.id !== opts.assistantMessageId));
    return 0;
  }

  const composed = composeStreamedAssistantMessage(
    opts.fullContent,
    opts.fullReasoning,
    opts.collectReasoning,
    opts.webSearchQuery,
    opts.allowWebSearchExtractFromMain,
    {
      webSearchEnabled: opts.webSearchEnabled,
      thinkingEnabled: opts.thinkingEnabled,
    }
  );
  let body = guardAssistantReplyContent(clipMessageContent(composed), {
    synthesizedRaw: opts.fullContent || composed,
    userQuestion: opts.userQuestion,
    webSearchEnabled: opts.webSearchEnabled,
    thinkingEnabled: opts.thinkingEnabled,
  });
  const finalized = finalizeAssistantMessageContent(body);
  if (finalized.content) body = finalized.content;
  const reason = extractStreamErrorReason(opts.error);
  const header =
    `⏸️ **${opts.modelLabel} 回复未完成**` +
    (reason ? `（${reason}）` : '（连接或流中断）') +
    `\n\n**已生成内容（保留）：**\n\n`;

  const preserved: ChatMessage = {
    id: `incomplete-attempt-${opts.modelSlug}-${Date.now()}`,
    role: 'assistant',
    content: header + body,
    tableRows: finalized.tableRows,
    timestamp: new Date(),
    isStreaming: false,
  };

  opts.setMessages((prev) =>
    prev.map((m) => (m.id === opts.assistantMessageId ? preserved : m))
  );
  console.warn(`[chat][${opts.modelLabel}] preserved incomplete stream before fallback`, {
    partialChars: partialLen,
  });
  return partialLen;
}

const AITOP100_SERVICE_LINE =
  '**服务方：** AITop100（AiTop）聚合接口（aitop100-api.hytch.com）。以下为接口或网关返回的信息。';

function formatAitopLlmFailure(modelLabel: string, detail: string): string {
  return `**❌ ${modelLabel}**\n${AITOP100_SERVICE_LINE}\n\n${detail}`;
}

function appendErrorIds(
  message: string,
  ids: { chatId?: string; requestId?: string; taskId?: string }
): string {
  let out = message || '';
  const lines: string[] = [];
  if (ids.chatId && !/\*\*对话ID\*\*/i.test(out)) lines.push(`**对话ID：** ${ids.chatId}`);
  if (ids.requestId && !/\*\*请求ID\*\*/i.test(out)) lines.push(`**请求ID：** ${ids.requestId}`);
  if (ids.taskId && !/\*\*Task ID\*\*/i.test(out)) lines.push(`**Task ID：** ${ids.taskId}`);
  if (!lines.length) return out;
  return `${out}\n\n${lines.join('\n')}`;
}

function pickRequestIdFromHeaders(headers: Headers): string | undefined {
  const keys = ['x-request-id', 'x-trace-id', 'request-id', 'trace-id'];
  for (const k of keys) {
    const v = headers.get(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function pickRequestIdFromStreamPayload(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const nested = d.data && typeof d.data === 'object' ? (d.data as Record<string, unknown>) : null;
  const candidates = [
    d.requestId,
    d.request_id,
    d.traceId,
    d.trace_id,
    nested?.requestId,
    nested?.request_id,
    nested?.traceId,
    nested?.trace_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

function mergeAitopRequestId(current: string | undefined, next?: string): string | undefined {
  if (current?.trim()) return current.trim();
  if (next?.trim()) return next.trim();
  return undefined;
}

type AitopErrorIds = { chatId?: string; requestId?: string; taskId?: string };

/** AiTop ???????????ID / ??ID???? x-request-id ?????? */
function formatAitopErr(modelLabel: string, detail: string, ids: AitopErrorIds = {}): string {
  return formatAitopLlmFailure(modelLabel, appendErrorIds(detail, ids));
}

/** AiTop ?? parse ??? formatAitopErr ? ?????????? SSE ???? */
function isAitopFormattedStreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const m = error.message;
  return (
    m.includes('AITop100') ||
    m.includes('\u274c') ||
    m.includes('\u5bf9\u8bddID\uFF1A') ||
    m.includes('\u95ee\u9898\uFF1A')
  );
}

function formatQwenFailure(detail: string): string {
  return `**❌ Qwen**\n\n${detail}\n\n**处理建议：** 若持续失败，请联系集团IT协助排查。`;
}

/** ?? AiTop chatId???? {USER_ID}_????? 32 ?? */
function normalizeAitopChatId(rawId: string | undefined, userId = GEMINI_API_CONFIG.USER_ID): string {
  const id = (rawId || '').trim();
  if (id && new RegExp(`^${userId}_[a-zA-Z0-9._-]+$`).test(id) && id.length <= 32) return id;
  const timestamp = Date.now().toString(36).slice(-8);
  const randomStr = Math.random().toString(36).substring(2, 7);
  return `${userId}_u_${timestamp}${randomStr}`.slice(0, 32);
}

function extractAitopApiErrorFromPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const code = d.code;
  const failed =
    d.success === false ||
    (typeof code === 'number' && code >= 10000) ||
    (typeof code === 'string' && /^\d{5,}$/.test(code));
  if (!failed) return null;
  if (typeof d.message === 'string' && d.message.trim()) return d.message.trim();
  if (typeof d.msg === 'string' && d.msg.trim()) return d.msg.trim();
  if (typeof d.content === 'string' && d.content.trim() && d.isDone) return d.content.trim();
  return `上游返回错误，code: ${String(code ?? 'unknown')}。`;
}

/** AiTop Gemini ?? 10001?????? */
function aitopGeminiUnavailableHint(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const code = (data as Record<string, unknown>).code;
  if (code === 10001 || code === '10001') {
    return (
      '\n\n**\u8bf4\u660e\uff1a** AiTop \u4fa7 Gemini \u901a\u9053\u6682\u4e0d\u53ef\u7528\uff08code 10001\uff09\uff0c' +
      '\u4e0e\u8054\u7f51/\u601d\u8003\u5f00\u5173\u65e0\u5173\uff0c\u5c5e\u4e0a\u6e38\u6545\u969c\u6216\u9650\u6d41\u3002' +
      '\u672c\u5e94\u7528\u4f1a\u81ea\u52a8\u5c1d\u8bd5 Claude 4.6\uff1b\u7a33\u5b9a\u4f7f\u7528\u8bf7\u6682\u65f6\u6539\u9009 Claude\u3002'
    );
  }
  return '';
}

async function readAitopJsonErrorIfAny(response: Response): Promise<string | null> {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) return null;
  try {
    const data = await response.clone().json();
    return extractAitopApiErrorFromPayload(data);
  } catch {
    return null;
  }
}

function throwAitopApiPayloadError(
  modelLabel: string,
  data: unknown,
  ids: { chatId?: string; requestId?: string }
): never {
  const msg = extractAitopApiErrorFromPayload(data) || '上游未返回详细错误信息';
  throw new Error(formatAitopErr(modelLabel, `**问题：** ${msg}`, ids));
}

/** ????? API Key */
function maskQwenApiKey(key: string): string {
  const k = (key || '').trim();
  if (k.length <= 8) return '***';
  return `${k.slice(0, 4)}?${k.slice(-4)}`;
}

function summarizeQwenMessagesForLog(messages: Array<{ role: string; content: unknown }>) {
  return messages.map((m, i) => {
    const c = m.content;
    if (typeof c === 'string') {
      return { i, role: m.role, contentType: 'string', textLen: c.length, preview: c.slice(0, 120) };
    }
    if (Array.isArray(c)) {
      return {
        i,
        role: m.role,
        contentType: 'multimodal',
        partCount: c.length,
        partKinds: c.map((p: { type?: string }) => p?.type || '?'),
      };
    }
    return { i, role: m.role, contentType: typeof c };
  });
}

function extractQwenAxiosErrorDiag(error: unknown): Record<string, unknown> {
  if (!axios.isAxiosError(error)) {
    return { errorKind: 'non-axios', message: toLogError(error) };
  }
  const hdr = error.response?.headers as Record<string, string | undefined> | undefined;
  let responseBodyPreview = '';
  try {
    const d = error.response?.data;
    responseBodyPreview =
      typeof d === 'string' ? d.slice(0, 1000) : JSON.stringify(d)?.slice(0, 1500) || '';
  } catch {
    responseBodyPreview = '[unserializable response body]';
  }
  return {
    errorKind: 'axios',
    code: error.code,
    message: error.message,
    httpStatus: error.response?.status,
    httpStatusText: error.response?.statusText,
    requestUrl: error.config?.url,
    requestMethod: error.config?.method,
    timeoutMs: error.config?.timeout,
    hasResponse: !!error.response,
    hasRequest: !!error.request,
    requestId:
              hdr?.['x-request-id'] ||
              hdr?.['x-trace-id'] ||
              hdr?.['request-id'] ||
      hdr?.['trace-id'],
    responseBodyPreview,
  };
}

function logQwenDebug(event: string, data: Record<string, unknown>): void {
  if (!isChatQwenDebugEnabled()) return;
  const bundle = {
    tag: 'chat-qwen-debug',
    event,
    at: new Date().toISOString(),
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    proxyHint:
      'Qwen 经 server.js axios 转发（同 test.py）→ models.fangte.com/v1/chat/completions',
    ...data,
  };
  console.warn('[chat][Qwen][debug]', bundle);
  try {
    console.warn('[chat][Qwen][debug][json]', JSON.stringify(bundle));
  } catch {
    console.warn('[chat][Qwen][debug][json]', String(bundle));
  }
}

function isLikelyTransientNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const code = String(error.code || '').toUpperCase();
  // 无 response 的 ERR_NETWORK 多为 CORS/被拦截，重试无效
  if (code === 'ERR_NETWORK' && !error.response) return false;
  const status = error.response?.status;
  if (status === 502 || status === 503 || status === 504) return true;
  // 客户端 axios 超时：重试通常无效（上游仍慢），勿当作可重试瞬断
  if (code === 'ECONNABORTED' && !error.response) return false;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return true;
  }
  if (!error.response) return true;
  return false;
}

function buildQwenNetworkErrorDetail(error: unknown): string {
  const msg = toLogError(error);
  if (axios.isAxiosError(error) && !error.response) {
    const code = String(error.code || '').toUpperCase();
    const reqUrl = String(error.config?.url || '');
    if (code === 'ERR_NETWORK' && /^https?:\/\//i.test(reqUrl)) {
      return (
        '**问题：** 浏览器跨域请求被拦截（CORS），网页不能直接访问 models.fangte.com。\n\n' +
        '**说明：** 请使用同源代理路径 `/api/fangte`（文本）或 `/api/v1`（多模态），由 server.js 转发；' +
        'Python 脚本可直连，但浏览器端必须走代理。\n'
      );
    }
  }
  return `**问题：** ${msg}`;
}

function buildQwenHttpErrorDetail(status: number, statusText: string, responseData: unknown): string {
  let detail = `**HTTP状态：** ${status} ${statusText || ''}\n\n`;
  const bodyStr =
    typeof responseData === 'string'
      ? responseData
      : responseData && typeof responseData === 'object'
        ? JSON.stringify(responseData)
        : String(responseData ?? '');
  if (bodyStr.trim()) detail += `**响应正文：** ${bodyStr.slice(0, 500)}\n\n`;
  if (status === 504) {
    detail +=
      '**说明：** 经 `server.js` 服务端转发至 `https://models.fangte.com/v1/chat/completions`（与 test.py 相同）。' +
      '若 test.py 在本机可成功而网页仍 504，请重启 node 并确认已部署最新 server.js；' +
      '可增大环境变量 `QWEN_PROXY_TIMEOUT_MS`（默认 600000）。\n';
  }
  return detail;
}

/** ????????????????????????????/??????/????? */
function isLikelyRetryablePrimaryModelError(error: unknown): boolean {
  if (isLikelyTransientNetworkError(error)) return true;
  const msg = (error instanceof Error ? error.message : String(error || '')).trim();
  if (!msg) return false;
  if (isLikelyUpstreamFallbackText(msg)) return false;

  const skipUnlessTimeout =
    msg.includes('\u672a\u751f\u6210\u6709\u6548') ||
    msg.includes('\u65e0\u6709\u6548\u56de\u7b54') ||
    msg.includes('\u7528\u6237\u53d6\u6d88') ||
    /AbortError/i.test(msg);
  if (
    skipUnlessTimeout &&
    !/\u9996\u5305|timeout|timed\s*out|\u8d85\u65f6/i.test(msg)
  ) {
    return false;
  }
  if (
    /\u6539\u9009\s*(Claude|Gemini|Qwen)|\u8bf7\u6539\u7528|\u5207\u6362.*\u6a21\u578b/i.test(msg)
  ) {
    return false;
  }

  const retryPhrases = [
    '\u672c\u9898\u672a\u80fd\u56de\u590d',
    '\u8bf7\u591a\u8bd5\u51e0\u6b21',
    '\u8bf7\u7a0d\u540e\u91cd\u8bd5',
    '\u6682\u65f6\u65e0\u6cd5',
    '\u6682\u65e0\u6cd5',
    '\u670d\u52a1\u7e41\u5fd9',
    '\u7cfb\u7edf\u7e41\u5fd9',
    '\u7f51\u5173',
    '\u9650\u6d41',
  ];
  if (retryPhrases.some((p) => msg.includes(p))) return true;

  return (
    /\u9996\u5305|timeout|timed\s*out|\u8d85\u65f6|ETIMEDOUT|ECONN|ERR_NETWORK|Failed to fetch|load failed/i.test(
      msg
    ) ||
    /(?:^|[^\d])(429|502|503|504)(?:[^\d]|$)|rate\s*limit|too many requests/i.test(msg) ||
    /upstream/i.test(msg)
  );
}

/** ????????????????????????????? negativePrompt + ?? Omni / Seedance2.0 ???? */
function buildNegativePromptPatchForChatNode(node: Node, selectedText: string): Partial<NodeData> {
  const d = node.data as NodeData;
  const model = d.selectedModel || '';
  const patch: Partial<NodeData> = { negativePrompt: selectedText };

  if (model === '??3.0 Omni') {
    patch.klingOmniMultiNegativePrompt = selectedText;
    patch.klingOmniInstructionNegativePrompt = selectedText;
    patch.klingOmniVideoNegativePrompt = selectedText;
    patch.klingOmniFramesNegativePrompt = selectedText;
    return patch;
  }

  if (['seedance2.0 (????)', 'seedance2.0 (???)'].includes(model)) {
    const prev = (d.seedanceTabConfigs || {}) as Record<string, Record<string, unknown>>;
    const next: Record<string, Record<string, unknown>> = { ...prev };
    for (const mode of ['text', 'image', 'reference'] as const) {
      next[mode] = { ...(next[mode] || {}), negativePrompt: selectedText };
    }
    patch.seedanceTabConfigs = next as NodeData['seedanceTabConfigs'];
    return patch;
  }

  return patch;
}

/** SSE ?? JSON ????????????????????????????????Console ????????? */
function warnChatSseLineParseSkipped(modelLabel: string, jsonStr: string, err: unknown) {
  console.warn(`[chat][${modelLabel}] SSE line parse skipped`, {
    preview: (jsonStr || '').slice(0, 240),
    error: toLogError(err),
  });
}

async function readStreamChunkWithIdle<T extends Uint8Array>(
  reader: ReadableStreamDefaultReader<T>,
  idleMs: number,
  onIdle: () => Error
): Promise<ReadableStreamReadResult<T>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(onIdle());
    }, idleMs);
    reader
      .read()
      .then((r) => {
        window.clearTimeout(timer);
        resolve(r);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

function composeStreamedAssistantMessage(
  rawContent: string,
  apiReasoning: string,
  collectApiReasoning: boolean,
  probeQuery?: string,
  allowWebSearchExtractFromMain = false,
  processModeOpts?: { webSearchEnabled?: boolean; thinkingEnabled?: boolean }
): string {
  const hasApiReasoning = !!(apiReasoning || '').trim();
  let sections = normalizeAssistantStream({
    content: rawContent,
    apiReasoning,
    collectApiReasoning,
    skipExtractThinkingFromMain: collectApiReasoning && hasApiReasoning,
    allowWebSearchExtractFromMain,
    allowThinkingExtractFromMain: collectApiReasoning,
  });
  if (processModeOpts) {
    sections = flattenAssistantSectionsWhenProcessDisabled(sections, processModeOpts);
  } else if (!allowWebSearchExtractFromMain && !collectApiReasoning) {
    sections = flattenAssistantSectionsWhenProcessDisabled(sections, {
      webSearchEnabled: false,
      thinkingEnabled: false,
    });
  }
  let composed = composeAssistantMessage(sections);
  if ((probeQuery || '').trim()) {
    composed = augmentWebSearchWithProbeQuery(composed, probeQuery!);
  }
  return composed;
}

/** ??????? + ??????? AiTop ?????? */
const AITOP_BASE_TIP_ZH =
  '请使用简体中文（中国大陆）回复，不要使用繁体中文。涉及行程、日程、列表、步骤时须写完整条目，勿用「…」或「...」省略未展开的内容。';

const AITOP_PROCESS_EXTRA_TIP_ZH =
  '过程说明请用中文；可保留 Search results for / I\'ll search for 等检索原文于过程区，正文写面向用户的完整回答。';

const AITOP_THINKING_ZH_TIP =
  '若启用思考，思考过程必须全程使用简体中文（含小标题与每一段说明），禁止使用英文。';

/**
 * 仅在用户问「你是谁/哪个模型」时注入（多模型路由必要约束）。
 * 普通问答不注入，避免过度约束、让上游按 API 自然回复。
 */
function buildAitopIdentityTip(modelLabel: string): string {
  const name = (modelLabel || '').trim();
  if (!name) return '';
  return `当前会话选用模型为「${name}」。请据此自我介绍，勿因对话历史或检索结果改称其他模型产品名。`;
}

function buildAitopTip(opts?: {
  thinking?: boolean;
  webSearch?: boolean;
  webSearchFirstPass?: boolean;
  skillTip?: string;
  modelLabel?: string;
  /** 仅身份元问题时注入模型名 tip */
  identityQuestion?: boolean;
}): string {
  // 联网首轮 tip 置空，避免干扰 tool-search
  if (opts?.webSearchFirstPass) {
    return ' ';
  }
  const parts = [AITOP_BASE_TIP_ZH];
  if (opts?.identityQuestion) {
    const identity = buildAitopIdentityTip(opts?.modelLabel || '');
    if (identity) parts.push(identity);
  }
  const skillTip = (opts?.skillTip || '').trim();
  if (skillTip) parts.push(skillTip);
  if (opts?.thinking) parts.push(AITOP_THINKING_ZH_TIP);
  if (opts?.thinking || opts?.webSearch) parts.push(AITOP_PROCESS_EXTRA_TIP_ZH);
  return parts.join('\n');
}

/** ??/?????????????????? 1200 ?/?????? */
function resolveHistoryMaxCharsPerMsg(latestUserText: string, webSearch: boolean): number {
  if (!webSearch) return CHAT_CTX_MAX_CHARS_PER_MSG;
  const q = (latestUserText || '').trim();
  if (/行程|攻略|第[一二三四五六七八九十\d]+天|第二天|第三天|规划|安排|几日游|天数/.test(q)) {
    return 4500;
  }
  return 2200;
}

function getQwenStreamDeltaContent(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const choice = data.choices?.[0];
  if (!choice) return '';
  const delta = choice.delta;
  if (typeof delta?.content === 'string') return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content
      .map((p: unknown) =>
        typeof p === 'string' ? p : (p as { text?: string })?.text || ''
      )
      .join('');
  }
  if (typeof choice.message?.content === 'string') return choice.message.content;
  return '';
}

function getQwenStreamFinishReason(data: any): string | undefined {
  const fr = data?.choices?.[0]?.finish_reason;
  return typeof fr === 'string' && fr ? fr : undefined;
}

/** 提取 AiTop SSE 流中的 finish_reason（借鉴 FastChat finish_reason 追踪） */
function getAitopStreamFinishReason(data: any): string | undefined {
  // AiTop 直接字段
  if (typeof data?.finish_reason === 'string' && data.finish_reason) return data.finish_reason;
  if (typeof data?.finishReason === 'string' && data.finishReason) return data.finishReason;
  // OpenAI 兼容格式
  const fr = data?.choices?.[0]?.finish_reason;
  if (typeof fr === 'string' && fr) return fr;
  return undefined;
}

function getStreamContentChunk(data: any): string {
  // AiTop ?????? code:20001??????
  if (extractAitopApiErrorFromPayload(data)) return '';
  // AiTop spec: ?? data.content
  if (typeof data?.content === 'string' && data.content) return data.content;
  if (data?.code || data?.success === false) return '';
  if (typeof data?.text === 'string' && data.text) return data.text;
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  if (typeof data?.response === 'string' && data.response) return data.response;
  if (typeof data?.answer === 'string' && data.answer) return data.answer;
  if (typeof data?.result === 'string' && data.result) return data.result;
  const dataMsg = data?.message;
  if (Array.isArray(dataMsg)) {
    const joined = dataMsg
      .map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object' && typeof x.text === 'string') return x.text;
        return '';
      })
      .filter(Boolean)
      .join('');
    if (joined) return joined;
  }
  const delta = data?.choices?.[0]?.delta;
  if (typeof delta?.content === 'string' && delta.content) return delta.content;
  if (typeof delta?.text === 'string' && delta.text) return delta.text;
  const msg = data?.choices?.[0]?.message;
  if (typeof msg?.content === 'string' && msg.content) return msg.content;
  if (Array.isArray(msg?.content)) {
    const joined = msg.content
      .map((x: any) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : ''))
      .filter(Boolean)
      .join('');
    if (joined) return joined;
  }
  if (typeof data?.choices?.[0]?.text === 'string' && data.choices[0].text) return data.choices[0].text;
  return '';
}

function getStreamReasoningChunk(data: any): string {
  if (typeof data?.reasoning_content === 'string' && data.reasoning_content) return data.reasoning_content;
  if (typeof data?.reasoningContent === 'string' && data.reasoningContent) return data.reasoningContent;
  if (typeof data?.thinkingContent === 'string' && data.thinkingContent) return data.thinkingContent;
  if (typeof data?.thinking_content === 'string' && data.thinking_content) return data.thinking_content;
  const delta = data?.choices?.[0]?.delta;
  if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta?.reasoningContent === 'string' && delta.reasoningContent) return delta.reasoningContent;
  if (typeof delta?.thinkingContent === 'string' && delta.thinkingContent) return delta.thinkingContent;
  return '';
}

function parseStreamPayloadLine(line: string): string | null {
  const t = (line || '').trim();
  if (!t) return null;
  const payload = t.startsWith('data:') ? t.substring(5).trim() : t;
  if (!payload || payload === '[DONE]') return null;
  return payload;
}

function clipMessageContent(text: string): string {
  return text;
}

const CHAT_CTX_MAX_TURNS = 32;
const CHAT_CTX_MAX_CHARS_PER_MSG = 6000;
const CHAT_CTX_MAX_TOTAL_CHARS = 48_000;
const AITOP_HISTORY_HEADER =
  '【会话历史（供延续上下文；请结合此前内容回答，勿当作全新对话）】';
const AITOP_USER_QUESTION_HEADER = '【用户本轮问题】';

function isMetaChatMessage(m: ChatMessage): boolean {
  if (m.id.startsWith('welcome-')) return true;
  if (m.id.startsWith('model-switch-')) return true;
  if (m.id.startsWith('fallback-switch-')) return true;
  if (m.id.startsWith('fallback-error-')) return true;
  const c = (m.content || '').trim();
  if (!c) return true;
  if (m.role === 'assistant' && /^🔄 已切换模型：/.test(c)) return true;
  if (m.role === 'assistant' && /^\*\*?\s+/.test(c)) return true;
  return false;
}

/** 模型切换/重试过程中产生的失败占位或错误气泡，不应与最终成功回复并存 */
function isFailedAssistantAttemptBubble(m: ChatMessage): boolean {
  if (m.role !== 'assistant') return false;
  if (isMetaChatMessage(m)) return true;
  if (isIncompleteAttemptMessage(m)) return false;
  const c = (m.content || '').trim();
  if (!c && !(m.tableRows?.length)) return true;
  if (/^⚠️/.test(c)) return true;
  if (/^\*\*❌/.test(c) || /^\*\*\?/.test(c)) return true;
  if (/失败\*\*|发送失败|Gateway Timeout|请求超时/i.test(c)) return true;
  return false;
}

/** 同一轮用户消息之后：保留未完成片段、切换说明，以及最终完整回复 */
function pruneTurnToSingleAssistantReply(
  messages: ChatMessage[],
  userMessageId: string
): ChatMessage[] {
  const userIdx = messages.findIndex((m) => m.id === userMessageId);
  if (userIdx < 0) return messages;
  const head = messages.slice(0, userIdx + 1);
  const tail = messages.slice(userIdx + 1);
  const preserved: ChatMessage[] = [];
  const substantive: ChatMessage[] = [];
  for (const m of tail) {
    if (m.role !== 'assistant') continue;
    if (m.id.startsWith('fallback-switch-') || isIncompleteAttemptMessage(m)) {
      preserved.push(m);
      continue;
    }
    if (isFailedAssistantAttemptBubble(m)) continue;
    substantive.push(m);
  }
  const last = substantive[substantive.length - 1];
  if (!last) return preserved.length ? [...head, ...preserved] : head;
  return [...head, ...preserved, last];
}

function truncateChatText(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}\n...（内容已截断）`;
}

/** 客户端 Token 估算（借鉴 llama.cpp LLMContextManager.estimateTokens） */
function estimateChatTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (isMetaChatMessage(msg)) continue;
    const text = msg.content || '';
    // 中文字符 ≈ 1.5 token，英文单词 ≈ 1.3 token，其他字符 ≈ 0.3 token
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherLen = text.length - chineseChars - englishWords;
    total += Math.round(chineseChars * 1.5 + englishWords * 1.3 + otherLen * 0.3);
  }
  return total;
}

/** Token 估算阈值（超过此值在输入框旁显示提示） */
const CHAT_TOKEN_WARNING_THRESHOLD = 8000;

/** ????????????????? Gemini ?? reasoning ?? Claude ?? */
function sanitizeContentForCrossModelHistory(content: string): string {
  return stripAssistantProcessForHistory(content || '');
}

function isNoisyAssistantHistory(content: string): boolean {
  const t = (content || '').trim();
  if (!t) return true;
  const sections = parseAssistantMessage(t);
  if (sections.main.length > 24) return false;
  return (
    (!sections.main && !!sections.webSearch) ||
    /^Search results for\s*"/i.test(t) ||
    /I'll search for\s*"/i.test(t) ||
    /Here are the search results/i.test(t) ||
    /I'll search for/i.test(t) ||
    /出了一些问题/.test(t) ||
    /请多试几次/.test(t)
  );
}

/** ????????????????? AiTop ????chatId ??????? */
function buildAitopUserQuestionOnly(latestUserText: string, tailAppend = ''): string {
  let body = (latestUserText || '').trim();
  if (tailAppend) body = body ? `${body}\n${tailAppend}` : tailAppend;
  return body;
}

/** ???????????????????????????? */
function needsWebSearchContextExpansion(latestUserText: string): boolean {
  const q = (latestUserText || '').trim();
  if (q.length <= 36) return true;
  return /^(今天|明天|后天|周[一二三四五六日天]|\d+月\d+日|几号|几点|天气|股价|汇率)/.test(q);
}

/** ??????????????????????????????????*/
function buildWebSearchDialogueContext(
  messages: ChatMessage[],
  latestUserText: string
): string {
  const turns = collectDialogueTurnsForApi(messages, latestUserText.trim(), {
    maxTurns: needsWebSearchContextExpansion(latestUserText) ? 10 : 8,
    maxCharsPerMsg: resolveHistoryMaxCharsPerMsg(latestUserText, true),
  });
  if (turns.length === 0) return '';
  return turns.map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`).join('\n\n');
}

/** ????????LLM ?? + ?????? utils/webSearchProbe.ts??*/
async function resolveWebSearchProbeMessageForAitop(
  api: { url: string; apiKey: string; model: string },
  messages: ChatMessage[],
  latestUserText: string,
  tailAppend: string,
  ephemeralChatId: string
): Promise<string> {
  const turns = collectDialogueTurnsForApi(messages, latestUserText.trim(), {
    maxTurns: 8,
    maxCharsPerMsg: 500,
  });
  return resolveWebSearchProbeQuery({
    url: api.url,
    apiKey: api.apiKey,
    model: api.model,
    chatId: ephemeralChatId,
    turns,
    latestUserText,
    tailAppend,
  });
}

/** ????????????????????????????????????*/
function collectDialogueTurnsForApi(
  messages: ChatMessage[],
  latestUserText: string,
  opts?: { maxTurns?: number; maxCharsPerMsg?: number }
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const latest = (latestUserText || '').trim();
  const maxTurns = opts?.maxTurns ?? CHAT_CTX_MAX_TURNS;
  const maxCharsPerMsg = opts?.maxCharsPerMsg ?? CHAT_CTX_MAX_CHARS_PER_MSG;
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (isMetaChatMessage(m)) continue;
    if (isIncompleteAttemptMessage(m)) continue;
    const content = truncateChatText(
      sanitizeContentForCrossModelHistory(m.content || ''),
      maxCharsPerMsg
    );
    if (!content) continue;
    if (m.role === 'assistant' && isNoisyAssistantHistory(content)) continue;
    if (m.role === 'user' && latest && content === latest) continue;
    turns.push({ role: m.role, content });
  }
  return turns.slice(-maxTurns);
}

/** AiTop Gemini/Claude 单 message 字段拼历史；Skill 优先保留，历史从最近一轮往前装包。 */
function buildAitopMessageWithHistory(
  messages: ChatMessage[],
  latestUserText: string,
  tailAppend = '',
  opts?: { webSearch?: boolean; skillBlock?: string }
): string {
  let body = (latestUserText || '').trim();
  if (tailAppend) body = body ? `${body}\n${tailAppend}` : tailAppend;
  const latest = (latestUserText || '').trim();
  const skillPrefix = (opts?.skillBlock || '').trim();
  const skillSection = skillPrefix ? `${skillPrefix}\n\n` : '';
  const userSection = `${AITOP_USER_QUESTION_HEADER}\n${body}`;

  const turns = collectDialogueTurnsForApi(messages, latest, {
    maxTurns: opts?.webSearch ? 8 : CHAT_CTX_MAX_TURNS,
    maxCharsPerMsg: opts?.webSearch
      ? resolveHistoryMaxCharsPerMsg(latest, true)
      : CHAT_CTX_MAX_CHARS_PER_MSG,
  });
  if (turns.length === 0) return skillSection + userSection;

  const overhead =
    skillSection.length +
    AITOP_HISTORY_HEADER.length +
    2 +
    userSection.length +
    4;
  const historyBudget = Math.max(0, CHAT_CTX_MAX_TOTAL_CHARS - overhead);

  const lines: string[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const label = t.role === 'user' ? '用户' : '助手';
    const block = `${label}：${t.content}`;
    if (total + block.length > historyBudget) break;
    lines.unshift(block);
    total += block.length;
  }
  if (lines.length === 0) return skillSection + userSection;

  return (
    skillSection +
    `${AITOP_HISTORY_HEADER}\n` +
    `${lines.join('\n\n')}\n\n` +
    userSection
  );
}

const UPSTREAM_FALLBACK_SIGNAL_RE =
  /请多试|多试几次|出了一些问题|未能回复|稍后再试|服务繁忙|繁忙|限流|队列|超时|维护|余额|upstream|rate\s*limit|overload|认证异常|鉴权|未授权|令牌无效|token|auth|no results found|未找到结果/i;

const UPSTREAM_FALLBACK_STRICT_RE = /出了一些问题|请多试|多试几次|未能回复|认证异常|no results found|未找到结果/;

const AITOP_AUTH_SIGNAL_RE = /认证异常|鉴权|未授权|令牌无效|token|auth/i;

type LlmSendRetryOptions = {
  degraded?: boolean;
  forceWebSearchOff?: boolean;
  summarizeSearchDumpText?: string;
  summarizeRetryCount?: number;
  /** ?????????????????? */
  summarizeCompact?: boolean;
  /** 长输出自动续写上下文（流中断且已输出较长时，同模型继续输出而非切换模型） */
  continuationContext?: {
    round: number;
    priorContent: string;
    priorReasoning: string;
    originalInput: string;
    assistantMessageId: string;
  };
};

/**
 * 判断流中断是否可自动续写（借鉴 grok-build classify_error → RetryDecision 思路）。
 * 仅当"已输出内容较长 + 错误为超时/流中断类 + 非鉴权/余额/内容过滤"时返回 true。
 */
function isContinuableStreamError(
  error: unknown,
  partialLen: number,
  round: number
): boolean {
  if (round >= MAX_AITOP_CONTINUATION_ROUNDS) return false;
  if (partialLen < AITOP_CONTINUATION_MIN_CHARS) return false;
  const msg = error instanceof Error ? error.message : String(error || '');
  if (!msg) return true; // 无明确错误信息但已输出较长内容，倾向续写
  // 鉴权 / 余额 / 内容过滤类错误不续写
  if (AITOP_AUTH_SIGNAL_RE.test(msg)) return false;
  if (/余额|配额|quota|insufficient|内容过滤|content.?filter|违规|敏感/i.test(msg)) return false;
  // 超时 / 流中断 / 空闲超时 / 网络瞬断类错误可续写
  if (/超时|timeout|timed?\s*out|空闲|idle|流中断|连接|abort|network|ETIMEDOUT|ECONN|Failed to fetch|load failed|未返回|响应体为空|无有效/i.test(msg)) {
    return true;
  }
  // 上游兜底文案类不续写（由 fallback 逻辑处理）
  if (/兜底|fallback|upstream/i.test(msg)) return false;
  // 其他未知错误，已输出较长则倾向续写
  return true;
}

/** 检测上下文溢出错误（借鉴 llama.cpp isContextOverflow 机制） */
function isContextOverflowError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '');
  return /context.?length|exceed.?context|context.?overflow|context.?size|上下文.?长|token.?limit|max.?token|context.?window|too.?long|exceed.?max|context.?limit|n_ctx/i.test(msg);
}

/** 构造续写 prompt：携带原问题 + 已输出内容尾部（借鉴 grok-build truncate_middle_words 保留尾部上下文） */
function buildContinuationPrompt(
  originalInput: string,
  priorContent: string
): string {
  const tail = (priorContent || '').slice(-AITOP_CONTINUATION_TAIL_CHARS);
  return [
    '【用户原问题】',
    originalInput || '',
    '',
    '【已输出内容尾部（请严格接着继续，不要重复已输出内容）】',
    tail,
    '',
    '请接着上文继续输出，保持连贯性，不要重复已输出内容。',
  ].join('\n');
}

/** AiTop `llm/see` ?? HTTP 200 ????????????????????????????????? */
function isLikelyUpstreamFallbackText(text: string): boolean {
  const t = (text || '').trim();
  if (!t || !UPSTREAM_FALLBACK_SIGNAL_RE.test(t)) return false;
  // ???? [????] ??????????? + ??????? >120 ??
  const main = t.split(/\n\n\[思考过程\]/)[0]?.trim() ?? t;
  if (main.length <= 200 && UPSTREAM_FALLBACK_STRICT_RE.test(main)) return true;
  // ??????????????????????????+ ??????
  if (t.length > 200) {
    const tail = t.slice(-180).trim();
    if (tail.length <= 180 && UPSTREAM_FALLBACK_STRICT_RE.test(tail)) return true;
  }
  return false;
}

/** ??????????????????????????????????? reasoning_content??*/
function detectUpstreamFallback(parts: {
  content?: string;
  reasoning?: string;
  combined?: string;
}): boolean {
  if (isLikelyUpstreamFallbackText(parts.content || '')) return true;
  if (isLikelyUpstreamFallbackText(parts.combined || '')) return true;
  const r = (parts.reasoning || '').trim();
  return r.length > 0 && r.length <= 200 && UPSTREAM_FALLBACK_STRICT_RE.test(r);
}

function isAitopAuthExceptionText(text: string): boolean {
  const t = (text || '').trim();
  return !!t && AITOP_AUTH_SIGNAL_RE.test(t);
}

/** AiTop `llm/see` ???? HTTP 200 ????????????????/??/??????*/
function warnIfLlmSeeLikelyUpstreamFallback(modelLabel: string, text: string) {
  const t = (text || '').trim();
  if (!isLikelyUpstreamFallbackText(t)) return;
  console.warn(`[chat][${modelLabel}] upstream fallback-like text`, { text: t });
}

/** ?????????/??????????????????? */
function isCurrentTimeUserQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /现在几点|当前时间|北京时间|今天几号|几点了|what\s*time|current\s*time/i.test(t);
}

function isWeatherUserQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t || isCurrentTimeUserQuestion(t)) return false;
  return /天气|气温|温度|降水|降雨|下雨|风力|湿度|多云|阴天|晴天|预报|冷|热/.test(t);
}

function extractWeatherFactsFromWebDump(dump: string): string {
  const lines = (dump || '').replace(/\r\n/g, '\n').split('\n');
  const picked: string[] = [];
  const seen = new Set<string>();
  const weatherCue = /(℃|°C|°|摄氏度|mm|%|级|风|雨|云|晴|阴|雾|温|湿|压|气象|预报|实况|日出|日落|月落|降雨)/;
  for (const raw of lines) {
    const ln = raw.replace(/\uFFFD/g, '').trim();
    if (ln.length < 4 || ln.length > 220) continue;
    if (!/\d/.test(ln) || !weatherCue.test(ln)) continue;
    if (/^https?:\/\//i.test(ln)) continue;
    if (/^[\?？]{2,}$/.test(ln)) continue;
    if (isInternalPromptBoilerplateLine(ln)) continue;
    const key = ln.slice(0, 72);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(ln);
    if (picked.length >= 28) break;
  }
  return picked.join('\n');
}

function buildSupplementalWeatherContextForSummarize(userQuestion: string, searchDump: string): string {
  if (!isWeatherUserQuestion(userQuestion)) return '';
  const facts = extractWeatherFactsFromWebDump(searchDump);
  if (!facts.trim()) {
    return (
      '【天气资料提示】检索摘要中未解析到清晰数值。请用简体中文写天气概况（晴/雨/多云等），' +
      '并说明温度、湿度、风力等具体数字以深圳市气象局或「检索来源」为准；禁止用连续问号占位。'
    );
  }
  return [
    '【从检索摘要抽取的天气数值与描述（须优先写入正文）】',
    facts,
    '说明：请把以上数字整理成可读实况（温度、湿度、风、降水等）；禁止输出 ???? 或连续问号；缺项可省略，勿臆造。',
  ].join('\n');
}

function compactSearchDumpForSummarize(text: string, maxChars = 4000, userQuestion = ''): string {
  const raw = stripInternalPromptBoilerplate(
    stripLeakedSearchBlocks((text || '').replace(/\r\n/g, '\n').trim())
  );
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^i'?ll search for\b/i.test(l))
    .filter((l) => {
      const qm = l.match(/"(.*?)"/) || l.match(/「([^」]*)」/);
      if (qm && isInternalPromptLeakQuery(qm[1])) return false;
      return true;
    });
  const picked: string[] = [];
  const weatherFirst: string[] = [];
  const weatherCue = /(℃|°C|mm|%|级|风|雨|云|晴|阴|温|湿|气象|预报|实况)/;
  for (const ln of lines) {
    if (/^please note/i.test(ln)) continue;
    if (isWeatherUserQuestion(userQuestion) && /\d/.test(ln) && weatherCue.test(ln)) {
      weatherFirst.push(ln);
    } else {
      picked.push(ln);
    }
    if (picked.length + weatherFirst.length >= 40) break;
  }
  const compact = [...weatherFirst, ...picked].join('\n');
  return compact.length <= maxChars ? compact : compact.slice(0, maxChars);
}

/** 联网检索二次总结：structured | natural（默认 natural） */
const WEB_SEARCH_SUMMARIZE_PROMPT_MODE: 'structured' | 'natural' = 'natural';

function buildSearchDumpSummarizePrompt(
  userQuestion: string,
  summarizedSearchDump: string,
  opts?: { compact?: boolean; dialogueContext?: string; skillBlock?: string }
): string {
  const skillPrefix = (opts?.skillBlock || '').trim();
  const question = (userQuestion || '').trim() || '请基于检索内容回答用户问题。';
  const maxChars = opts?.compact
    ? 2800
    : isDetailRichUserQuestion(question)
      ? 6000
      : 4000;
  const compactDump =
    compactSearchDumpForSummarize(summarizedSearchDump || '', maxChars, question) ||
    '（检索摘要为空，请如实说明无法从检索获得有效信息。）';
  const dialogueBlock = (opts?.dialogueContext || '').trim()
    ? `【对话上下文】\n${opts.dialogueContext.trim()}\n\n`
    : '';

  if (WEB_SEARCH_SUMMARIZE_PROMPT_MODE === 'natural') {
    const weatherContext = buildSupplementalWeatherContextForSummarize(
      question,
      summarizedSearchDump || ''
    );
    const source = [weatherContext, compactDump].filter(Boolean).join('\n\n');
    const body =
      `你是中文助手。请根据下方「用户问题」与「参考资料」写面向用户的完整回答。\n` +
      `要求：必须使用简体中文（大陆），禁止繁体字；不要复述 Search results 编号列表或粘贴长 URL；不要写 The user is asking… 等英文分析。\n` +
      `用分点或小标题写出可直接阅读的建议，链接最多保留 0-2 条且用简短描述代替裸链。\n` +
      `天气类问题须写出温度、湿度、风力、降水等具体数字（从参考资料摘录）；禁止用 ???? 或连续问号占位。\n\n` +
      dialogueBlock +
      `【用户问题】\n${question}\n\n` +
      `【参考资料】\n${source}`;
    return skillPrefix ? `${skillPrefix}\n\n${body}` : body;
  }

  const weatherContext = buildSupplementalWeatherContextForSummarize(
    question,
    summarizedSearchDump || ''
  );
  const source = [weatherContext, compactDump].filter(Boolean).join('\n\n');
  const wantsTable = /表格|列表|对比|排行/.test(question);
  const weatherAnswerHint = isWeatherUserQuestion(question)
    ? `8) 天气问题：正文须含具体数字（℃、%、mm、风力等级等），禁止问号占位。\n`
    : '';
  const tableHint = wantsTable
    ? `7) 用户需要表格时，用 Markdown 表格呈现。\n`
    : '';
  const body =
    `你是中文助手。请根据检索资料用简体中文回答用户问题。\n` +
    dialogueBlock +
    `【用户问题】\n${question}\n\n` +
    `【写作要求】\n` +
    `1) 先给 1-2 句结论。\n` +
    `2) 正文 2-4 段，条理清晰。\n` +
    `3) 不要粘贴原始检索编号列表。\n` +
    `4) 禁止 The user is asking… 等元叙述。\n` +
    `5) 数字、日期须与资料一致；资料矛盾时简要说明并给出最可信结论。\n` +
    `6) 使用简体中文，禁止繁体。\n` +
    weatherAnswerHint +
    tableHint +
    `\n【参考资料】\n${source}`;
  return skillPrefix ? `${skillPrefix}\n\n${body}` : body;
}

/** 问候 / 自我介绍 / 致谢等短句：不开联网首轮，避免历史话题污染检索词 */
function isLightweightPrompt(text: string): boolean {
  return isNonSearchableChatUtterance(text);
}

function toLogError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 流式渲染助手正文（借鉴 grok-build / FastChat 直接渲染，不使用打字机动画） */
const StreamingAssistantMain = memo(function StreamingAssistantMain({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const main = sanitizeAssistantDisplayText(
    resolveAssistantDisplaySections(content || '').main
  ).trim();
  // 借鉴 FastChat：TTFB 期间显示三点跳动 loading 动画，消除空白等待感
  if (!main) {
    if (isStreaming) {
      return (
        <div className="flex items-center gap-1 py-1" aria-label="正在思考">
          <span className="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text text-gray-100">
      {main}
      {isStreaming ? (
        <span
          className="inline-block w-0.5 h-[1em] align-[-0.12em] ml-0.5 bg-brand-400/90 animate-pulse"
          aria-hidden
        />
      ) : null}
    </div>
  );
});

function renderAssistantMainContent(content: string, isStreaming?: boolean): React.ReactNode {
  const main = sanitizeAssistantDisplayText(
    resolveAssistantDisplaySections(content || '').main
  ).trim();
  if (!main) return null;
  return <StreamingAssistantMain content={content} isStreaming={isStreaming} />;
}

/** ???? / ???????????? */
function AssistantProcessCard(props: {
  title: string;
  sections: Array<{ label: string; body: string; sourcesStyle?: boolean }>;
  defaultExpanded?: boolean;
  previewHint?: string;
}) {
  const visible = props.sections.filter((sec) => (sec.body || '').trim());
  if (!visible.length) return null;
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const preview =
    props.previewHint?.trim() ||
    visible
      .map((s) => s.body.replace(/\s+/g, ' ').trim())
      .join(' ')
      .slice(0, 96);

  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-900/55 overflow-hidden text-gray-400">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/50 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-xs font-semibold tracking-wide text-gray-300 flex-1">{props.title}</span>
        <span className="text-[10px] text-gray-500 shrink-0">{expanded ? '收起' : '展开'}</span>
        {expanded ? (
          <ChevronUp size={14} className="text-gray-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-gray-500 shrink-0" />
        )}
      </button>
      {!expanded && preview ? (
        <div className="px-3 pb-2 text-[11px] text-gray-500 leading-snug truncate">{preview}</div>
      ) : null}
      {expanded ? (
        <div className="px-3 pb-2 border-t border-gray-700/40">
          {visible.map((sec, i) => (
            <div key={`${sec.label}-${i}`} className={i > 0 ? 'mt-2 pt-2 border-t border-gray-700/40' : 'pt-2'}>
              {sec.label.trim() ? (
                <div className="text-[11px] font-medium text-gray-500 mb-1">{sec.label}</div>
              ) : null}
              <div
                className={
                  sec.sourcesStyle
                    ? 'text-xs leading-relaxed whitespace-pre-wrap font-[450] select-text text-gray-500 max-h-48 overflow-y-auto'
                    : 'text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text text-gray-400'
                }
              >
                {sec.body}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderAssistantProcessPanels(content: string, opts?: { isStreaming?: boolean }): React.ReactNode {
  const parsed = resolveAssistantDisplaySections(content || '');
  const { webSearch, thinking } = parsed;
  const cleanedWebSearch = sanitizeWebSearchProcessText(webSearch);
  const { process: webProcess, sources: webSources } = splitWebSearchForDisplay(cleanedWebSearch);
  const localizedProcess = localizeWebSearchProcessForDisplay(webProcess, {
    completed: !!webSources.trim() || parsed.main.trim().length > 40,
  });
  const thinkingBody = sanitizeAssistantDisplayText(localizeThinkingProcessForDisplay(thinking));
  if (!cleanedWebSearch.trim() && !thinkingBody.trim()) return null;

  const webPreview =
    localizedProcess.split('\n').find((l) => l.trim())?.trim().slice(0, 96) || '联网检索中…';
  const thinkPreview =
    thinkingBody.split('\n').find((l) => l.trim())?.trim().slice(0, 96) || '思考中…';

  return (
    <div className="space-y-2 mb-3">
      {cleanedWebSearch.trim() ? (
        <AssistantProcessCard
          title={ASSISTANT_MARKER_WEB_SEARCH}
          defaultExpanded={!!opts?.isStreaming && !parsed.main.trim()}
          previewHint={webPreview}
          sections={[
            ...(localizedProcess.trim()
              ? [{ label: '搜索过程', body: localizedProcess }]
              : []),
            ...(webSources.trim()
              ? [{ label: '检索来源', body: webSources, sourcesStyle: true }]
              : []),
          ]}
        />
      ) : null}
      {thinkingBody.trim() ? (
        <AssistantProcessCard
          title={ASSISTANT_MARKER_THINKING}
          defaultExpanded={!!opts?.isStreaming && !parsed.main.trim()}
          previewHint={thinkPreview}
          sections={[{ label: '思考过程', body: thinkingBody }]}
        />
      ) : null}
    </div>
  );
}

function renderAssistantTextContent(content: string, isStreaming?: boolean): React.ReactNode {
  return (
    <div className="space-y-2">
      {renderAssistantProcessPanels(content, { isStreaming })}
      {renderAssistantMainContent(content, isStreaming)}
    </div>
  );
}

/** ?????? memo???????????????? */
const ChatMessageRow = memo(function ChatMessageRow({
  message,
  index,
}: {
  message: ChatMessage;
  index: number;
}) {
  const displayContent = clipMessageContent(message.content);
  const imagesToShow = message.imageUrls || (message.imageUrl ? [message.imageUrl] : []);
  const displayImageSrc = (url: string) => resolveDisplayMediaUrl(url);
  const assistantParsedMain =
    message.role === 'assistant' ? parseAssistantMessage(displayContent).main.trim() : displayContent.trim();
  const pipeTableSegments =
    message.role === 'assistant' && assistantParsedMain.length > 0
      ? segmentMessageByPipeTables(assistantParsedMain)
      : null;
  const segmentTableCount = pipeTableSegments?.filter((s) => s.kind === 'table').length ?? 0;
  const usePipeSegmentLayout =
    segmentTableCount > 0 && (segmentTableCount > 1 || !message.tableRows?.length);
  const assistantStreaming = message.role === 'assistant' && !!message.isStreaming;

  return (
    <div
      className={`flex items-end ${message.role === 'user' ? 'justify-end' : 'justify-start'} gap-3 animate-[slideIn_0.3s_ease-out]`}
      style={{ animationDelay: `${Math.min(index, 20) * 50}ms` }}
      data-message-id={message.id}
    >
      {message.role === 'assistant' && (
        <div className="relative flex-shrink-0">
          <div className="absolute -inset-1 bg-gradient-to-br from-brand-500/40 to-purple-500/40 rounded-full blur-md animate-pulse"></div>
          <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-brand-500/40 flex items-center justify-center shadow-xl">
            <Bot size={20} className="text-brand-400" strokeWidth={2.5} />
          </div>
        </div>
      )}

      <div
        className={`max-w-[90%] rounded-2xl p-4 shadow-2xl backdrop-blur-sm select-text cursor-text ${
          message.role === 'user'
            ? 'bg-gradient-to-br from-brand-600 via-brand-500 to-brand-600 text-white border border-brand-400/30'
            : 'bg-gradient-to-br from-gray-800/90 to-gray-900/90 text-gray-100 border border-gray-700/60'
        }`}
      >
        {message.tableRows && message.tableRows.length > 0 ? (
          <>
            {message.role === 'assistant' ? renderAssistantProcessPanels(displayContent, { isStreaming: assistantStreaming }) : null}
            {assistantParsedMain.length > 0 ? (
              <div className="mb-2">
                {message.role === 'assistant' ? (
                  renderAssistantMainContent(displayContent, assistantStreaming)
                ) : (
                  <div className="text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text">
                    {displayContent}
                  </div>
                )}
              </div>
            ) : null}
            <ChatTableHtml rows={message.tableRows} />
          </>
        ) : usePipeSegmentLayout && pipeTableSegments && pipeTableSegments.length > 0 ? (
          <div className="space-y-3">
            {message.role === 'assistant' ? renderAssistantProcessPanels(displayContent, { isStreaming: assistantStreaming }) : null}
            {pipeTableSegments.map((seg, si) =>
              seg.kind === 'text' ? (
                <div key={`t-${si}`}>
                  {message.role === 'assistant' ? (
                    renderAssistantMainContent(seg.text, assistantStreaming)
                  ) : (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text">
                      {seg.text}
                    </div>
                  )}
                </div>
              ) : (
                <ChatTableHtml key={`tbl-${si}`} rows={seg.matrix} />
              )
            )}
          </div>
        ) : (
          <>
            {message.role === 'assistant' ? (
              renderAssistantTextContent(displayContent, assistantStreaming)
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text">
                {displayContent}
              </div>
            )}
          </>
        )}
        {imagesToShow.length > 0 && (
          <div className="mt-3 space-y-2">
            {imagesToShow.map((imageUrl, imgIndex) => {
              const isVideo =
                /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(imageUrl) || imageUrl.includes('video');
              return isVideo ? (
                <div
                  key={imgIndex}
                  className="rounded-xl overflow-hidden border border-gray-700/60 shadow-xl ring-1 ring-black/30"
                >
                  <video
                    src={displayImageSrc(imageUrl)}
                    className="w-full max-h-64 object-cover"
                    controls
                    muted
                    playsInline
                  />
                </div>
              ) : (
                <div
                  key={imgIndex}
                  className="rounded-xl overflow-hidden border border-gray-700/60 shadow-xl ring-1 ring-black/30"
                >
                  <img
                    src={displayImageSrc(imageUrl)}
                    alt={`图片 ${imgIndex + 1}`}
                    className="w-full max-h-64 object-cover"
                    loading="lazy"
                  />
                </div>
              );
            })}
          </div>
        )}
        <div
          className={`text-[10px] mt-3 opacity-50 ${
            message.role === 'user' ? 'text-right text-white/80' : 'text-left text-gray-400'
          }`}
        >
          {message.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {message.role === 'user' && (
        <div className="relative flex-shrink-0">
          <div className="absolute -inset-1 bg-gradient-to-br from-brand-500/50 to-purple-500/50 rounded-full blur-md"></div>
          <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-brand-600 to-brand-500 border-2 border-brand-400/40 flex items-center justify-center shadow-xl">
            <User size={20} className="text-white" strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
});

function normalizeModelId(modelId: string): string {
  return normalizeChatModelId(modelId);
}

/** ????AI ????????localStorage ??????????*/
const CHAT_CANVAS_PERSIST_KEY = 'flowgen:chat:canvas-session';

export function chatStateFromPersistedV1(
  o: PersistedCanvasChatV1 | null | undefined
): { messages: ChatMessage[]; chatId: string; modelId: string } | null {
  if (!o || o.v !== 1 || !Array.isArray(o.messages) || o.messages.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const item of o.messages) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const id = typeof item.id === 'string' ? item.id : `restored-${messages.length}`;
    const content = typeof item.content === 'string' ? item.content : '';
    const ts = item.timestamp ? Date.parse(item.timestamp) : NaN;
    const msg: ChatMessage = {
      id,
      role: item.role,
      content,
        timestamp: new Date(Number.isFinite(ts) ? ts : Date.now()),
    };
    if (typeof item.imageUrl === 'string') msg.imageUrl = item.imageUrl;
    if (Array.isArray(item.imageUrls)) msg.imageUrls = item.imageUrls.filter((x): x is string => typeof x === 'string');
    if (Array.isArray(item.tableRows) && item.tableRows.length > 0) {
      const tr: string[][] = [];
      for (const r of item.tableRows) {
        if (!Array.isArray(r)) continue;
        const row = r.map((c) => String(c ?? '').slice(0, 4000));
        if (row.length) tr.push(row);
      }
      if (tr.length) msg.tableRows = tr.slice(0, 200);
    }
    messages.push(msg);
  }
  if (messages.length === 0) return null;
  return {
    messages,
    chatId: typeof o.chatId === 'string' ? o.chatId : '',
    modelId: normalizeModelId(typeof o.modelId === 'string' ? o.modelId : 'claude-4.5'),
  };
}

function createWelcomeChatMessage(skill?: ProjectSkillConfig | null): ChatMessage {
  return {
    id: 'welcome-' + Date.now(),
    role: 'assistant',
    content: buildCanvasWelcomeChatContent(skill),
    timestamp: new Date(),
  };
}

function parsePersistedCanvasChat(storageKey = CHAT_CANVAS_PERSIST_KEY): {
  messages: ChatMessage[];
  chatId: string;
  modelId: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PersistedCanvasChatV1>;
    if (o?.v !== 1 || !Array.isArray(o.messages)) return null;
    return chatStateFromPersistedV1(o as PersistedCanvasChatV1);
  } catch {
    return null;
  }
}

function persistCanvasChat(
  snapshot: { chatId: string; modelId: string; messages: ChatMessage[] },
  opts?: {
    storageKey?: string;
    skipLocal?: boolean;
    onServer?: (body: PersistedCanvasChatV1) => void;
  }
) {
  if (typeof window === 'undefined') return;
  try {
    const serializable = snapshot.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      timestamp: (m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as unknown as string)).toISOString(),
      ...(m.imageUrl ? { imageUrl: m.imageUrl.slice(0, 500_000) } : {}),
      ...(m.imageUrls?.length ? { imageUrls: m.imageUrls.slice(0, 24).map((u) => u.slice(0, 500_000)) } : {}),
      ...(m.tableRows?.length
        ? {
            tableRows: m.tableRows.slice(0, 120).map((row) =>
              row.slice(0, 48).map((cell) => String(cell).slice(0, 4000))
            ),
          }
        : {}),
    }));
    const body: PersistedCanvasChatV1 = {
      v: 1,
      chatId: snapshot.chatId,
      modelId: normalizeModelId(snapshot.modelId),
      messages: serializable,
    };
    opts?.onServer?.(body);
    if (opts?.skipLocal) return;
    const serialized = profileSync('chat-persist-stringify', () => JSON.stringify(body), {
      messages: snapshot.messages.length,
      modelId: snapshot.modelId,
    });
    localStorage.setItem(opts?.storageKey ?? CHAT_CANVAS_PERSIST_KEY, serialized);
  } catch {
    /* quota / ??????*/
  }
}

const getNodeTypeName = (type: string): string => {
  switch (type) {
    case NodeType.INPUT:
      return '输入';
    case NodeType.PROCESSOR:
      return '处理';
    case NodeType.OUTPUT:
      return '输出';
    case NodeType.MOV:
      return '视频';
    case NodeType.CHAIN_FOLDER:
      return '链路折叠';
    default:
      return '节点';
  }
};

export const ChatPanel = React.forwardRef<ChatPanelHandle, ChatPanelProps>(
(
  {
    selectedNode,
    selectedNodes,
    getCanvasSelectedNodes,
    getCanvasNodes,
    workspaceProjectId,
    updateSelectedNodesData,
    getLiveTemplateData,
    onSpawnStoryboardNodesFromTable,
    chatIdUserTag,
    onChatIdChange,
    onChatActivity,
    canvasChatPersistence = 'local',
    canvasChatStorageKey,
    initialCanvasChatV1,
    onCanvasChatSnapshot,
    chatStorageScope: chatStorageScopeProp,
    projectSkill = null,
    projectAssetLabelRows,
  },
  ref
) => {
  const chatStorageScope = useMemo(
    () =>
      chatStorageScopeProp ??
      resolveChatStorageScope(getStoredUser()?.id, null),
    [chatStorageScopeProp]
  );
  const sessionsStorageKey = useMemo(
    () => chatSessionsListStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const localHistoryStorageKey = useMemo(
    () => chatLocalHistoryStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const lsKey = canvasChatStorageKey ?? CHAT_CANVAS_PERSIST_KEY;
  const projectSkillRef = useRef(projectSkill);
  useEffect(() => {
    projectSkillRef.current = projectSkill ?? null;
  }, [projectSkill]);
  const activeProjectSkill = isProjectSkillActive(projectSkill) ? projectSkill : null;
  const projectSkillBlock = useMemo(() => buildProjectSkillBlock(projectSkill), [projectSkill]);
  const resolveProjectSkillBlock = () =>
    buildProjectSkillBlock(projectSkillRef.current) || projectSkillBlock;
  const initialChatState = useMemo(() => {
    if (canvasChatPersistence === 'server' && initialCanvasChatV1 === null) {
      return { messages: [createWelcomeChatMessage(projectSkill)], chatId: '', modelId: 'claude-4.5' };
    }
    const fromServer = chatStateFromPersistedV1(initialCanvasChatV1 ?? undefined);
    if (fromServer) return fromServer;
    const p = parsePersistedCanvasChat(lsKey);
    if (p) return p;
    if (chatStorageScope.projectId) {
      const legacy = parsePersistedCanvasChat(`flowgen:chat:canvas-session:${chatStorageScope.projectId}`);
      if (legacy) return legacy;
    }
    return { messages: [createWelcomeChatMessage(projectSkill)], chatId: '', modelId: 'claude-4.5' };
  }, [initialCanvasChatV1, lsKey, chatStorageScope.projectId, projectSkill]);

  const [messages, setMessages] = useState<ChatMessage[]>(initialChatState.messages);
  const [visibleMessageCount, setVisibleMessageCount] = useState<number>(() =>
    Math.min(initialChatState.messages.length, CHAT_RENDER_PAGE_SIZE)
  );
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(initialChatState.modelId);
  const [showModelSelector, setShowModelSelector] = useState<boolean>(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('off'); // ???????/??/??
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false); // ???????Gemini/Claude?
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [referencedImage, setReferencedImage] = useState<string | null>(null); // ???????????????????????????
  const [referencedImages, setReferencedImages] = useState<string[]>([]); // ?????????????????????????????
  const [selectedText, setSelectedText] = useState<string>('');
  const [contextTableRows, setContextTableRows] = useState<string[][] | null>(null);
  const [showNodePreview, setShowNodePreview] = useState<boolean>(true); // ??????????
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null); // ????
  const [contextMessageId, setContextMessageId] = useState<string | null>(null); // 右键消息 ID
  const [chatId, setChatId] = useState<string>(initialChatState.chatId); // Gemini / Claude ????id
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>('');
  const [sessionExportMenu, setSessionExportMenu] = useState<SessionExportMenuState>(null);
  const [sessions, setSessions] = useState<StoredSession[]>(() =>
    loadStoredSessions(chatStorageScopeProp ?? resolveChatStorageScope(getStoredUser()?.id, null))
  );
  const [localUserTag, setLocalUserTag] = useState<string>(() => {
    const v = localStorage.getItem(CHAT_USER_TAG_KEY);
    return v && v.trim() ? v : 'local';
  });
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string>(initialChatState.chatId);
  /** ????????????????????????? fallback ??? */
  const sessionDisplayModelRef = useRef<string>(normalizeModelId(initialChatState.modelId));
  /** 本轮对话固定会话 id（发送时绑定，避免模型切换时产生多条历史） */
  const activeSessionChatIdRef = useRef<string>(initialChatState.chatId || '');
  const persistSnapshotRef = useRef({ messages, chatId, modelId: selectedModel });
  persistSnapshotRef.current = { messages, chatId, modelId: selectedModel };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollBottomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatPersistIdleRef = useRef<number | null>(null);
  const shouldAutoScrollRef = useRef(true);
  /** ??/??????????????????????????????????????????????*/
  const degradedOnceAfterModelSwitchRef = useRef(false);
  /** ?????????????????? */
  const toggleSnapshotBeforeModelSwitchRef = useRef<{
    thinkingMode: ThinkingMode;
    useWebSearch: boolean;
  } | null>(null);
  /** 主模型流式失败后保留的已生成字数，供 fallback 提示使用 */
  const lastFailedStreamCharsRef = useRef(0);
  const isSendingRef = useRef(false); // 并发发送锁（借鉴 FastChat limit_worker_concurrency）
  const webSearchProbeCacheRef = useRef<string | null>(null); // 联网检索 probe 结果缓存，避免 fallback 链重复调用

  const beginDegradedUiForModelSwitch = useCallback((hadThinkingOrWeb: boolean) => {
    degradedOnceAfterModelSwitchRef.current = true;
    if (!hadThinkingOrWeb) return;
    toggleSnapshotBeforeModelSwitchRef.current = {
      thinkingMode,
      useWebSearch,
    };
    setThinkingMode('off');
    setUseWebSearch(false);
  }, [thinkingMode, useWebSearch]);

  const endDegradedModelSwitch = useCallback(() => {
    degradedOnceAfterModelSwitchRef.current = false;
    const snap = toggleSnapshotBeforeModelSwitchRef.current;
    toggleSnapshotBeforeModelSwitchRef.current = null;
    if (snap) {
      setThinkingMode(snap.thinkingMode);
      setUseWebSearch(snap.useWebSearch);
    }
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
                // ??????
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= 24;
  }, []);

  const firstVisibleMessageIndex = useMemo(
    () => Math.max(0, messages.length - visibleMessageCount),
    [messages.length, visibleMessageCount]
  );
  const visibleMessages = useMemo(
    () => messages.slice(firstVisibleMessageIndex),
    [messages, firstVisibleMessageIndex]
  );
  const hasHiddenMessages = firstVisibleMessageIndex > 0;
  const handleLoadOlderMessages = useCallback(() => {
    const el = messagesContainerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setVisibleMessageCount((prev) => Math.min(messages.length, prev + CHAT_RENDER_PAGE_SIZE));
    window.requestAnimationFrame(() => {
      const nextEl = messagesContainerRef.current;
      if (!nextEl) return;
      const nextHeight = nextEl.scrollHeight;
      nextEl.scrollTop += Math.max(0, nextHeight - prevHeight);
    });
  }, [messages.length]);

  useEffect(() => {
    setVisibleMessageCount((prev) => {
      if (messages.length === 0) return 0;
      if (messages.length <= prev) return messages.length;
      if (shouldAutoScrollRef.current) {
        // ?????????????????????????????
        return Math.min(messages.length, Math.max(prev, CHAT_RENDER_PAGE_SIZE));
      }
      return prev;
    });
  }, [messages.length]);

  // ?????????? messages ??????? scrollIntoView + smooth ?????
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    if (scrollBottomTimerRef.current) clearTimeout(scrollBottomTimerRef.current);
    scrollBottomTimerRef.current = setTimeout(() => {
      scrollBottomTimerRef.current = null;
      messagesEndRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' });
    }, isLoading ? 220 : 140);
    return () => {
      if (scrollBottomTimerRef.current) clearTimeout(scrollBottomTimerRef.current);
    };
  }, [visibleMessages, isLoading]);

                // ??????
  useEffect(() => {
    if (selectedNode || selectedNodes.length > 0) {
      setShowNodePreview(true);
    }
  }, [selectedNode, selectedNodes]);

                // ??????
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const panelEl = panelRef.current;
      if (!panelEl || !panelEl.contains(target)) {
        setContextMenu(null);
        setSessionExportMenu(null);
        setContextMessageId(null);
        return;
      }

                // ??????
      if (target.closest('[data-history-session-item="1"]')) {
        setContextMenu(null);
        return;
      }

                // 检测右键点击的消息行
      const msgRow = target.closest('[data-message-id]') as HTMLElement | null;
      if (msgRow) {
        setContextMessageId(msgRow.getAttribute('data-message-id'));
      } else {
        setContextMessageId(null);
      }

                // ??????
      if (
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'INPUT' ||
        target.isContentEditable ||
        target.closest('textarea') ||
        target.closest('input')
      ) {
        setContextMenu(null);
        return; // ??????????
      }

      const selection = window.getSelection();
      const selectedTextContent =
        selection && selection.rangeCount > 0 ? selection.toString().trim() : '';
      setSelectedText(selectedTextContent.length > 0 ? selectedTextContent : '');

      const tableEl = findChatTableFromContext(target, selection);
      if (tableEl && panelEl.contains(tableEl)) {
        const rows = extractRowsFromHtmlTable(tableEl);
        setContextTableRows(rows.length > 0 ? rows : null);
      } else {
        setContextTableRows(null);
      }

      e.preventDefault(); // ????????????????
      setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
                // ??????
      if (target && !target.closest('.context-menu')) {
        setContextMenu(null);
      }
      if (target && !target.closest('.history-session-menu')) {
        setSessionExportMenu(null);
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  /** ??localStorage ??????????????? chatId ????*/
  useEffect(() => {
    if (initialChatState.chatId) onChatIdChange?.(initialChatState.chatId);
    // ?????????    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ??????????????????*/
  useEffect(() => {
    if (chatPersistIdleRef.current != null && typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(chatPersistIdleRef.current);
      chatPersistIdleRef.current = null;
    }
    const t = window.setTimeout(() => {
      const runPersist = () => {
        persistCanvasChat(
          { chatId, modelId: selectedModel, messages },
          {
            storageKey: lsKey,
            skipLocal: canvasChatPersistence === 'server',
        onServer: canvasChatPersistence === 'server' ? onCanvasChatSnapshot : undefined,
          }
        );
      };
      if (typeof requestIdleCallback !== 'undefined') {
        chatPersistIdleRef.current = requestIdleCallback(() => {
          chatPersistIdleRef.current = null;
          runPersist();
        }, { timeout: 2500 });
      } else {
        runPersist();
      }
    }, 600);
    return () => {
      window.clearTimeout(t);
      if (chatPersistIdleRef.current != null && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(chatPersistIdleRef.current);
        chatPersistIdleRef.current = null;
      }
      if (canvasChatPersistence === 'server' && onCanvasChatSnapshot) {
        persistCanvasChat(persistSnapshotRef.current, {
          storageKey: lsKey,
          skipLocal: true,
          onServer: onCanvasChatSnapshot,
        });
      }
    };
  }, [messages, chatId, selectedModel, lsKey, canvasChatPersistence, onCanvasChatSnapshot]);

  useEffect(() => {
    const flush = () => {
      if (canvasChatPersistence !== 'server' || !onCanvasChatSnapshot) return;
      persistCanvasChat(persistSnapshotRef.current, {
        storageKey: lsKey,
        skipLocal: true,
        onServer: onCanvasChatSnapshot,
      });
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('flowgen:flush-canvas-chat', flush);
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('flowgen:flush-canvas-chat', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [lsKey, canvasChatPersistence, onCanvasChatSnapshot]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_USER_TAG_KEY, localUserTag);
    } catch {
      // ignore
    }
  }, [localUserTag]);

  // ?????????? /whoami ??
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ?????????????? local??????
        if (localStorage.getItem(CHAT_USER_TAG_KEY) && localUserTag !== 'local') return;
        const res = await fetch('/whoami');
        if (!res.ok) return;
        const data = (await res.json()) as { username?: string };
        const name = (data?.username || '').trim();
        if (!name) return;
        if (cancelled) return;
        setLocalUserTag(name);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(sessionsStorageKey, JSON.stringify(sessions.slice(0, 60)));
    } catch {
      // ignore
    }
  }, [sessions, sessionsStorageKey]);

  useEffect(() => {
    setSessions(loadStoredSessions(chatStorageScope));
  }, [sessionsStorageKey, chatStorageScope]);

  // 刷新后优先与服务端会话列表对齐（跨设备可见），并与本地索引合并，避免“看起来被清空”。
  useEffect(() => {
    let cancelled = false;
    const syncSessionListFromServer = async () => {
      try {
        const resp = await listChatHistory(chatStorageScope.projectId ?? undefined);
        const rows = Array.isArray(resp?.sessions) ? resp.sessions : [];
        if (rows.length === 0 || cancelled) return;
        setSessions((prev) => {
          const byId = new Map<string, StoredSession>();
          for (const s of prev) {
            if (!s?.chatId) continue;
            byId.set(s.chatId, {
              ...s,
              updatedAt: normalizeSessionUpdatedAt(s.updatedAt),
            });
          }
          for (const r of rows) {
            const chatId = String(r?.chatId || '').trim();
            if (!chatId) continue;
            const prevSession = byId.get(chatId);
            const remoteUpdatedAt = normalizeSessionUpdatedAt(r?.updatedAt);
            const merged: StoredSession = {
              chatId,
              modelId: normalizeModelId(String(r?.modelId || prevSession?.modelId || 'qwen')),
              updatedAt: Math.max(remoteUpdatedAt, normalizeSessionUpdatedAt(prevSession?.updatedAt)),
            };
            const remoteTitle = normalizeTitleFromText(String(r?.firstMessage || ''));
            const prevTitle = String(prevSession?.title || '').trim();
            if (prevTitle) merged.title = prevTitle;
            else if (remoteTitle) merged.title = remoteTitle;
            byId.set(chatId, merged);
          }
          return [...byId.values()]
            .sort((a, b) => normalizeSessionUpdatedAt(b.updatedAt) - normalizeSessionUpdatedAt(a.updatedAt))
            .slice(0, 60);
        });
      } catch (e) {
        console.warn('[chat] Failed to list server chat sessions:', e);
      }
    };
    void syncSessionListFromServer();
    return () => {
      cancelled = true;
    };
  }, [chatStorageScope.projectId, sessionsStorageKey]);

  useEffect(() => {
    chatIdRef.current = chatId;
    if (chatId) activeSessionChatIdRef.current = chatId;
  }, [chatId]);

  // ?????title ???? UI ? chatId ??
  useEffect(() => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!s || !s.chatId) return s;
        if (s.title && s.title.trim()) return s;
        changed = true;
        return { ...s, title: '', modelId: normalizeModelId(s.modelId) };
      });
      return changed ? next : prev;
    });
  }, []);

  // ??????selectedModel ?????????????????????????
  useEffect(() => {
    const normalized = normalizeModelId(selectedModel);
    if (normalized !== selectedModel) setSelectedModel(normalized);
  }, [selectedModel]);

  // ??????????????click ????mousedown??????? onClick ????
  useEffect(() => {
    if (!showModelSelector) return;
    const onDocClick = (e: MouseEvent) => {
      const el = modelMenuRef.current;
      const t = e.target as unknown as globalThis.Node | null;
      if (!el || !t) return;
      if (!el.contains(t)) setShowModelSelector(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [showModelSelector]);

                // ??????
  /** ???????????? chatId????AiTop ????????????*/
  const rotateChatId = (): string => {
    chatIdRef.current = '';
    return generateChatId();
  };

  /** ?? probe / ???????????? chatId??????????id ?? */
  const createEphemeralChatId = (): string => {
    const timestamp = Date.now().toString(36).slice(-8);
    const randomStr = Math.random().toString(36).substring(2, 7);
    const appUsername = (getStoredUser()?.username || '').trim();
    const tag = (appUsername || chatIdUserTag || localUserTag || 'local')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 12) || 'l';
    const suffix = `${tag}_${timestamp}${randomStr}`.slice(0, 20);
    return `${GEMINI_API_CONFIG.USER_ID}_${suffix}`.slice(0, 32);
  };

  // ??Gemini/Claude??ID
  const generateChatId = (): string => {
    if (!chatIdRef.current) {
      const timestamp = Date.now().toString(36).slice(-8);
      const randomStr = Math.random().toString(36).substring(2, 7);

      const appUsername = (getStoredUser()?.username || '').trim();
      const tag = (appUsername || chatIdUserTag || localUserTag || 'local')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .slice(0, 12) || 'l';
      const suffix = `${tag}_${timestamp}${randomStr}`.slice(0, 20);
      const newChatId = `${GEMINI_API_CONFIG.USER_ID}_${suffix}`.slice(0, 32);
      chatIdRef.current = newChatId;
      setChatId(newChatId);
      onChatIdChange?.(newChatId);
      return newChatId;
    }
    return chatIdRef.current;
  };

  const modelLabelById = (modelId: string): string => chatModelDisplayLabel(modelId);

  const fallbackChainByPrimary = (modelId: string): string[] => chatModelFallbackChain(modelId);

  const sendByModel = async (
    modelId: string,
    text: string,
    images: string[],
    chatIdForActivity?: string,
    sendOpts?: { fromFallback?: boolean }
  ) => {
    if (isAitopLlmUiModel(modelId)) {
      await handleAitopLlmSend(modelId, text, images, chatIdForActivity);
      return;
    }
    if (modelId === QWEN_CHAT_UI_ID) {
      logQwenDebug('routed_from_send', {
        chatId: chatIdForActivity,
        textLen: (text || '').length,
        imageCount: images.length,
        webSearchEnabled: useWebSearch,
        thinkingMode,
        fromFallback: !!sendOpts?.fromFallback,
        note: 'Qwen 路径不含 Claude/Gemini 的 webSearch/thinking 参数',
      });
      await handleQwenSend(text, images, chatIdForActivity, 0, sendOpts);
      return;
    }
    throw new Error('未支持的聊天模型，请选择 Gemini / Claude / DeepSeek / DouBao / Qwen');
  };

  /**
   * ??????????????? 1 ????????????????Claude/Gemini ? ?? ? Qwen?
   */
  const attemptSendWithFallback = async (
    modelId: string,
    text: string,
    images: string[],
    chatIdForActivity?: string,
    userMessageId?: string
  ): Promise<string> => {
    const finishTurn = (usedModelId: string): string => {
      if (userMessageId) {
        setMessages((prev) => {
          const pruned = pruneTurnToSingleAssistantReply(prev, userMessageId);
          persistSnapshotRef.current = {
            ...persistSnapshotRef.current,
            messages: pruned,
          };
          return pruned;
        });
      }
      lastFailedStreamCharsRef.current = 0;
      return usedModelId;
    };

    lastFailedStreamCharsRef.current = 0;
    try {
      await sendByModel(modelId, text, images, chatIdForActivity);
      return finishTurn(modelId);
    } catch (primaryError) {
      const primaryLabel = modelLabelById(modelId);
      const fallbackChain = fallbackChainByPrimary(modelId);

      // 上下文溢出检测（借鉴 llama.cpp isContextOverflow）：不切换模型，直接提示用户
      if (isContextOverflowError(primaryError)) {
        setMessages((prev) => [
          ...prev,
          {
            id: `context-overflow-${Date.now()}`,
            role: 'assistant' as const,
            content: `**⚠️ 对话上下文过长**\n\n当前对话历史已超出模型上下文窗口限制，建议开启新对话或删除部分历史消息后重试。`,
            timestamp: new Date(),
          },
        ]);
        return finishTurn(modelId);
      }

      if (fallbackChain.length === 0) throw primaryError;

      let effectivePrimaryError: unknown = primaryError;
      if (
        PRIMARY_SAME_MODEL_RETRY_ONCE &&
        isLikelyRetryablePrimaryModelError(primaryError)
      ) {
        const retryChatId = createEphemeralChatId();
        try {
          await sendByModel(modelId, text, images, retryChatId);
          return finishTurn(modelId);
        } catch (retryErr) {
          effectivePrimaryError = retryErr;
        }
      }

      const formatModelFailureContent = (label: string, err: unknown) =>
        err instanceof Error ? err.message : `**? ${label} ??**\n\n${String(err)}`;

      const errorSections: string[] = [formatModelFailureContent(primaryLabel, effectivePrimaryError)];
      let failedLabel = primaryLabel;

      for (const fallbackModel of fallbackChain) {
        const fallbackLabel = modelLabelById(fallbackModel);
        const switchReason = extractStreamErrorReason(
          errorSections[errorSections.length - 1] ?? effectivePrimaryError
        );

        setMessages((prev) => [
          ...prev,
          {
            id: `fallback-switch-${fallbackModel}-${Date.now()}`,
            role: 'assistant' as const,
            content: buildFallbackSwitchNotice(
              failedLabel,
              fallbackLabel,
              lastFailedStreamCharsRef.current,
              switchReason
            ),
            timestamp: new Date(),
          },
        ]);

        try {
          const fallbackApiChatId = createEphemeralChatId();
          const hadThinkingOrWeb = thinkingMode !== 'off' || useWebSearch;
          if (fallbackModel === 'qwen' && hadThinkingOrWeb) {
            beginDegradedUiForModelSwitch(hadThinkingOrWeb);
          }
          await sendByModel(fallbackModel, text, images, fallbackApiChatId, { fromFallback: true });
          return finishTurn(fallbackModel);
        } catch (fallbackError) {
          const fallbackErrContent = formatModelFailureContent(fallbackLabel, fallbackError);
          errorSections.push(fallbackErrContent);
          failedLabel = fallbackLabel;
        }
      }

      throw new Error(errorSections.join('\n\n---\n'));
    }
  };

  const resetConversation = (nextChatId?: string) => {
    setIsLoading(false);
    setInput('');
    setAttachedImages([]);
    setReferencedImage(null);
    setReferencedImages([]);
    setSelectedText('');
    chatIdRef.current = nextChatId || '';
    setChatId(nextChatId || '');
    if (nextChatId) onChatIdChange?.(nextChatId);
    activeSessionChatIdRef.current = nextChatId || '';
    sessionDisplayModelRef.current = normalizeModelId(selectedModel);
    const welcome = createWelcomeChatMessage(projectSkillRef.current);
    const nextMessages = [welcome];
    setMessages(nextMessages);
    persistSnapshotRef.current = {
      ...persistSnapshotRef.current,
      messages: nextMessages,
      chatId: nextChatId || '',
      modelId: normalizeModelId(selectedModel),
    };
    if (canvasChatPersistence === 'server' && onCanvasChatSnapshot) {
      persistCanvasChat(persistSnapshotRef.current, {
        storageKey: lsKey,
        skipLocal: true,
        onServer: onCanvasChatSnapshot,
      });
    }
  };

  useImperativeHandle(ref, () => ({
    resetConversation,
    setChatId: (nextChatId: string) => {
      chatIdRef.current = nextChatId;
      setChatId(nextChatId);
      onChatIdChange?.(nextChatId);
    },
    getChatId: () => chatId,
    setMessages: (m: ChatMessage[]) => setMessages(m),
    getMessages: () => messages,
  }), [chatId, messages, onChatIdChange]);

  /** 固定当前连续对话的 chatId，避免每轮发送因 ref 失步而新建历史条目 */
  const ensureConversationSessionId = (): string => {
    const existing = activeSessionChatIdRef.current || chatIdRef.current || chatId;
    if (existing) {
      activeSessionChatIdRef.current = existing;
      if (chatIdRef.current !== existing) {
        chatIdRef.current = existing;
        setChatId(existing);
        onChatIdChange?.(existing);
      }
      return existing;
    }
    const fresh = generateChatId();
    activeSessionChatIdRef.current = fresh;
    return fresh;
  };

  /** 历史列表仅去重 chatId 并排序；不在展示层折叠/删除条目（避免点击时误消失） */
  const sortedSessions = useMemo(() => {
    const uniq = new Map<string, StoredSession>();
    for (const s of sessions) {
      if (!s?.chatId) continue;
      const prev = uniq.get(s.chatId);
      if (
        !prev ||
        normalizeSessionUpdatedAt(s.updatedAt) > normalizeSessionUpdatedAt(prev.updatedAt)
      ) {
        uniq.set(s.chatId, s);
      }
    }
    return [...uniq.values()]
      .sort((a, b) => normalizeSessionUpdatedAt(b.updatedAt) - normalizeSessionUpdatedAt(a.updatedAt))
      .slice(0, 60);
  }, [sessions]);

  const upsertSession = (
    chatIdToSave: string,
    patch: Partial<StoredSession> & { replaceModelId?: boolean }
  ) => {
    if (!chatIdToSave) return;
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.chatId === chatIdToSave);
      const base: StoredSession =
        idx >= 0
          ? { ...prev[idx], modelId: normalizeModelId(prev[idx].modelId) }
          : {
              chatId: chatIdToSave,
              modelId: normalizeModelId(String(patch.modelId || selectedModel)),
              updatedAt: Date.now(),
            };
      const next: StoredSession = {
        ...base,
        updatedAt: Date.now(),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
      };
      if (idx < 0) {
        next.modelId = normalizeModelId(String(patch.modelId || selectedModel));
      } else if (patch.replaceModelId && patch.modelId) {
        next.modelId = normalizeModelId(patch.modelId);
      }
      const list = idx >= 0 ? [...prev.slice(0, idx), next, ...prev.slice(idx + 1)] : [next, ...prev];
      return list.slice(0, 60);
    });
  };

  /**
   * 本轮发送结束后写入/更新一条会话历史。
   * 仅 upsert 当前 chatId，不删除其它条目（fallback 后服务端/本地可能各有索引，误删会导致点击后消失）。
   */
  const commitTurnSession = (
    sessionChatId: string,
    latestQuestion: string,
    usedModelId?: string
  ) => {
    if (!sessionChatId) return;
    const displayModel = normalizeModelId(
      usedModelId || sessionDisplayModelRef.current || selectedModel
    );
    const title = normalizeTitleFromText(latestQuestion);
    setSessions((prev) => {
      let next = [...prev];
      const idx = next.findIndex((s) => s.chatId === sessionChatId);
      if (idx >= 0) {
        const cur = next[idx];
        const merged: StoredSession = {
          ...cur,
          updatedAt: Date.now(),
          title: cur.title?.trim() || title || cur.title,
          modelId: displayModel,
        };
        next = [...next.slice(0, idx), merged, ...next.slice(idx + 1)];
      } else if (title) {
        next = [
          {
            chatId: sessionChatId,
            modelId: displayModel,
            title,
            updatedAt: Date.now(),
          },
          ...next,
        ];
      }
      return next.slice(0, 60);
    });
  };

  const deleteSession = async (chatIdToDelete: string) => {
    if (!chatIdToDelete) return;
    if (!window.confirm('确定删除该条聊天历史？删除后无法恢复。')) return;
    setSessions((prev) => prev.filter((s) => s.chatId !== chatIdToDelete));
    try {
      const map = readLocalHistoryMap();
      if (map[chatIdToDelete]) {
        delete map[chatIdToDelete];
        writeLocalHistoryMap(map);
      }
    } catch {
      // ignore local history cleanup failure
    }
    // ????????Qwen ????
    try {
      await deleteChatHistory(chatIdToDelete, {
        projectId: chatStorageScope.projectId ?? null,
      });
    } catch {
      // ?????????????
    }
    if (chatId === chatIdToDelete) {
      resetConversation();
    }
  };

  const normalizeTitleFromText = (text: string): string => {
    const t = (text || '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    // ???????????
    return t.slice(0, 36);
  };

  const readLocalHistoryMap = (): LocalHistoryMap =>
    safeJsonParse<LocalHistoryMap>(localStorage.getItem(localHistoryStorageKey), {});

  const writeLocalHistoryMap = (next: LocalHistoryMap) => {
    localStorage.setItem(localHistoryStorageKey, JSON.stringify(next));
  };

  const normalizeMessagesForLocalHistory = (msgs: ChatMessage[]) =>
    msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-80)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp:
          m.timestamp instanceof Date
            ? m.timestamp.toISOString()
            : new Date(m.timestamp).toISOString(),
        imageUrl: m.imageUrl,
        imageUrls: m.imageUrls,
        tableRows: m.tableRows,
      }));

  const persistLocalHistory = (
    chatIdToSave: string,
    modelIdToSave: string,
    msgs: ChatMessage[]
  ) => {
    if (!chatIdToSave) return;
    const compact = normalizeMessagesForLocalHistory(msgs);
    if (compact.length === 0) return;
    const next = readLocalHistoryMap();
    next[chatIdToSave] = {
      modelId: normalizeModelId(modelIdToSave),
      updatedAt: Date.now(),
      messages: compact,
    };
    writeLocalHistoryMap(next);
  };

  const readLocalHistoryMessages = (
    chatIdToLoad: string,
    modelIdToLoad?: string
  ): ChatMessage[] => {
    const map = readLocalHistoryMap();
    const rec = map[chatIdToLoad];
    if (!rec || !Array.isArray(rec.messages) || rec.messages.length === 0) return [];
    return rec.messages.map((m, idx) => ({
      id: m.id || `${m.role}-${idx}-${Date.now()}`,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
      timestamp: new Date(m.timestamp || Date.now()),
      imageUrl: m.imageUrl,
      imageUrls: m.imageUrls,
      tableRows: m.tableRows,
    }));
  };

  const readDbHistoryMessages = async (
    chatIdToLoad: string,
    _modelIdToLoad?: string
  ): Promise<ChatMessage[]> => {
    try {
      const record = await getChatHistory(chatIdToLoad, {
        projectId: chatStorageScope.projectId ?? null,
      });
      const items = Array.isArray(record?.messages) ? record.messages : [];
      if (items.length === 0) return [];
      return items.map((m, idx) => ({
        id: m.id || `${m.role}-${idx}-${Date.now()}`,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
        timestamp: new Date(m.timestamp || Date.now()),
        imageUrl: m.imageUrl,
        imageUrls: m.imageUrls,
        tableRows: m.tableRows,
      }));
    } catch {
      return [];
    }
  };

  const upsertServerHistory = async (chatIdToSave: string, modelId: string, msgs: ChatMessage[]) => {
    if (!chatIdToSave) return;
    persistLocalHistory(chatIdToSave, modelId, msgs);
    const compact = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-80)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString(),
        imageUrl: m.imageUrl,
        imageUrls: m.imageUrls,
        tableRows: m.tableRows,
      }));
    try {
      await saveChatHistory(chatIdToSave, normalizeModelId(modelId), compact, {
        projectId: chatStorageScope.projectId ?? null,
      });
    } catch (e) {
      console.warn('[chat] Failed to save history to server:', e);
    }
  };

  // Gemini / Claude 走外部 API；本地保留最近历史作为兜底，避免上游 chatId 偶发不可读时“有列表无内容”。
  useEffect(() => {
    if (!chatId) return;
    persistLocalHistory(chatId, selectedModel, messages);
  }, [chatId, selectedModel, messages, localHistoryStorageKey]);

  // 统一归档：Qwen/Claude/Gemini 都写入数据库，便于 API 波动时回捞历史。
  const lastServerArchiveSigRef = useRef('');
  useEffect(() => {
    if (!chatId || isLoading) return;
    const compact = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (compact.length === 0) return;
    const model = sessionDisplayModelRef.current || normalizeModelId(selectedModel);
    const tail = compact[compact.length - 1];
    const sig = `${chatId}|${model}|${compact.length}|${tail?.id || ''}|${(tail?.content || '').length}`;
    if (lastServerArchiveSigRef.current === sig) return;
    lastServerArchiveSigRef.current = sig;
    void upsertServerHistory(chatId, model, messages);
  }, [chatId, messages, isLoading, selectedModel, chatStorageScope.projectId]);

  const fetchHistory = async (chatIdToLoad: string, modelIdToLoad?: string): Promise<ChatMessage[]> => {
    const normalizedModel = normalizeModelId(modelIdToLoad || '');
    if (normalizedModel === 'qwen') {
      try {
        const record = await getChatHistory(chatIdToLoad, {
          projectId: chatStorageScope.projectId ?? null,
        });
        const items = Array.isArray(record?.messages) ? record.messages : [];
        const serverMsgs: ChatMessage[] = items.map((m, idx) => ({
          id: m.id || `${m.role}-${idx}-${Date.now()}`,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
          timestamp: new Date(m.timestamp || Date.now()),
          imageUrl: m.imageUrl,
          imageUrls: m.imageUrls,
          tableRows: m.tableRows,
        }));
        if (serverMsgs.length > 0) {
          persistLocalHistory(chatIdToLoad, normalizedModel, serverMsgs);
          return serverMsgs;
        }
        const localFallback = readLocalHistoryMessages(chatIdToLoad, normalizedModel);
        if (localFallback.length > 0) return localFallback;
        throw new Error('未找到 Qwen 历史记录，chatId 可能已失效。');
      } catch (e) {
        const localFallback = readLocalHistoryMessages(chatIdToLoad, normalizedModel);
        if (localFallback.length > 0) return localFallback;
        throw new Error('加载 Qwen 历史失败：未找到该 chatId 对应记录。');
      }
    }

    try {
      const url = `${GEMINI_API_CONFIG.BASE_URL}/api/v1/llm/list?chatId=${encodeURIComponent(chatIdToLoad)}&start=0&limit=50`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': AITOP_LLM_API.API_KEY,
        },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`历史查询失败: HTTP ${res.status} ${res.statusText}\n${t}`);
      }
      const data = (await res.json()) as any;
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      const serverMsgs = items.map((it, idx) => {
        const parts: string[] = [];
        if (typeof it?.content === 'string' && it.content) parts.push(it.content);
        if (typeof it?.thinkingContent === 'string' && it.thinkingContent) parts.push(`\n\n[思考过程]\n${it.thinkingContent}`);
        const ts = typeof it?.createTime === 'string' ? Date.parse(it.createTime) : NaN;
        return {
          id: `${it?.role || 'msg'}-${idx}-${Date.now()}`,
          role: it?.role === 'assistant' ? 'assistant' : 'user',
          content: parts.join(''),
          timestamp: new Date(Number.isFinite(ts) ? ts : Date.now()),
        } satisfies ChatMessage;
      });
      if (serverMsgs.length > 0) {
        persistLocalHistory(chatIdToLoad, normalizedModel || 'gemini-3.1', serverMsgs);
        return serverMsgs;
      }
    } catch {
      // ignore and continue fallbacks
    }
    const dbFallback = await readDbHistoryMessages(chatIdToLoad, normalizedModel);
    if (dbFallback.length > 0) {
      persistLocalHistory(chatIdToLoad, normalizedModel || 'gemini-3.1', dbFallback);
      return dbFallback;
    }
    const localFallback = readLocalHistoryMessages(chatIdToLoad, normalizedModel);
    if (localFallback.length > 0) return localFallback;
    throw new Error(`未找到历史记录：chatId=${chatIdToLoad}`);
  };

  const openSessionAndLoad = async (chatIdToLoad: string, modelId: string) => {
    setHistoryError('');
    setHistoryLoading(true);
    const loadedModel = normalizeModelId(modelId);
    // 立即绑定目标会话，避免加载期间 ref 仍指向旧会话
    activeSessionChatIdRef.current = chatIdToLoad;
    try {
      const msgs = await fetchHistory(chatIdToLoad, modelId);
      // 仅在加载成功后再切换会话，避免失败时污染当前会话状态
      sessionDisplayModelRef.current = loadedModel;
      setSelectedModel(loadedModel);
      setShowModelSelector(false);
      resetConversation(chatIdToLoad);
      // ?????user ?????????????????????????
      const firstUser = msgs.find((m) => m.role === 'user' && m.content && m.content.trim());
      const derivedTitle = firstUser ? normalizeTitleFromText(firstUser.content) : '';
      setMessages([
        {
          id: 'welcome-' + Date.now(),
          role: 'assistant',
          content: `✅ 已加载历史，会话可继续对话。`,
          timestamp: new Date(),
        },
        ...msgs,
      ]);
      upsertSession(chatIdToLoad, {
        modelId: normalizeModelId(modelId),
        ...(derivedTitle ? { title: derivedTitle } : {}),
        replaceModelId: true,
      });
      setHistoryOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isMissingHistory = /未找到该 chatId|未找到历史记录|chatId 可能已失效/.test(msg);
      // 历史列表仅允许手动删除（点 X）。读取失败时保留记录，避免误删。
      if (isMissingHistory) {
        setHistoryError('该会话当前无法加载（记录已保留，可稍后重试）。');
      } else {
        setHistoryError(msg);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const buildCompactBackup = (session: StoredSession, msgs: ChatMessage[]): CompactChatBackupV1 => {
    const compactMessages = msgs
      .slice(-40)
      .map((m) => ({
        role: m.role,
        content: (m.content || '').slice(0, 2200),
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString(),
      }))
      .filter((m) => m.content.trim().length > 0);
    return {
      v: 1,
      kind: 'flowgen-chat-backup',
      exportedAt: new Date().toISOString(),
      chatId: session.chatId,
      modelId: normalizeModelId(session.modelId),
      title: session.title?.trim() || '未命名会话',
      messages: compactMessages,
    };
  };

  const buildRestoreTextFromBackup = (backup: CompactChatBackupV1): string => {
    const dialogText = backup.messages
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n\n');
    return [
      `【历史会话备份】`,
      `标题：${backup.title}`,
      `模型：${backup.modelId}`,
      `导出时间：${backup.exportedAt}`,
      '',
      '请基于下面历史内容继续对话：',
      dialogText || '(无可用历史内容)',
    ].join('\n');
  };

  const saveTextAsFile = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyTextWithFallback = async (text: string) => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const clipboard = nav?.clipboard as { writeText?: (v: string) => Promise<void> } | undefined;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('当前环境不支持自动复制，请改用“导出对话备份（JSON）”后手动复制。');
  };

  const exportSessionBackup = async (session: StoredSession) => {
    try {
      setHistoryError('');
      setHistoryLoading(true);
      const msgs = await fetchHistory(session.chatId, session.modelId);
      const backup = buildCompactBackup(session, msgs);
      const restoreText = buildRestoreTextFromBackup(backup);
      const payload = {
        backup,
        restoreText,
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      saveTextAsFile(`chat-backup-${session.chatId}-${stamp}.json`, JSON.stringify(payload, null, 2));
    } catch (e) {
      setHistoryError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHistoryLoading(false);
      setSessionExportMenu(null);
    }
  };

  const copySessionRestoreText = async (session: StoredSession) => {
    try {
      setHistoryError('');
      setHistoryLoading(true);
      const msgs = await fetchHistory(session.chatId, session.modelId);
      const backup = buildCompactBackup(session, msgs);
      const restoreText = buildRestoreTextFromBackup(backup);
      await copyTextWithFallback(restoreText);
    } catch (e) {
      setHistoryError(`复制失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHistoryLoading(false);
      setSessionExportMenu(null);
    }
  };

  // ??????? URL ????? base64?blob??? URL?
  const processImageUrl = async (imageUrl: string): Promise<string> => {
    // ???????URL?Qwen????????
    const isVideoUrl = /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(imageUrl) || 
                      imageUrl.includes('video') ||
                      (selectedNode && selectedNode.type === NodeType.MOV);
    
    if (isVideoUrl) {
      throw new Error('Qwen 暂不支持视频输入，请移除视频后重试');
    }
    
    // base64??????AiTop????????URL
    if (imageUrl.startsWith('data:image/')) {
      const uploadedUrl = await uploadImage(imageUrl);
      if (uploadedUrl) {
        return uploadedUrl;
    } else {
        throw new Error('base64 图片上传至 AiTop 失败');
      }
    }
    
    // blob URL????AiTop????????URL
    if (imageUrl.startsWith('blob:')) {
      const uploadedUrl = await uploadImage(imageUrl);
      if (uploadedUrl) {
        return uploadedUrl;
      } else {
        throw new Error('blob 图片上传至 AiTop 失败');
      }
    }
    
    // ?? URL??????Qwen API ?????? URL?
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }

    // /flowgen-api 素材：带 token 拉取后上传为公网 URL
    if (isFlowgenProtectedAssetFileUrl(imageUrl) || imageUrl.startsWith('/flowgen-api/')) {
      const uploadedUrl = await uploadImage(resolveDisplayMediaUrl(imageUrl));
      if (uploadedUrl) return uploadedUrl;
      throw new Error('素材库图片上传失败');
    }

    return imageUrl;
  };

  const handleSend = async () => {
    // 并发发送锁（借鉴 FastChat limit_worker_concurrency）
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    webSearchProbeCacheRef.current = null; // 新消息：清空 probe 缓存
    try {
    // ?? referencedImages??????? referencedImage + attachedImages
    const allImages: string[] = [];
    const imageSet = new Set<string>(); // ????
    
                // ??????
    if (referencedImages.length > 0) {
      referencedImages.forEach(img => {
        if (!imageSet.has(img)) {
          allImages.push(img);
          imageSet.add(img);
        }
      });
    } else {
                // ??????
      if (referencedImage && !imageSet.has(referencedImage)) {
        allImages.push(referencedImage);
        imageSet.add(referencedImage);
      }
      if (attachedImages.length > 0) {
        attachedImages.forEach(img => {
          if (!imageSet.has(img)) {
            allImages.push(img);
            imageSet.add(img);
          }
        });
      }
    }
    
    const hasImages = allImages.length > 0;
    const hasText = input.trim().length > 0;
    if ((!hasText && !hasImages) || isLoading) return;

    const userMessage: ChatMessage = {
      id: 'user-' + Date.now(),
      role: 'user',
      content: input,
      imageUrl: allImages.length > 0 ? allImages[0] : undefined,
      imageUrls: allImages.length > 0 ? allImages : undefined,
      timestamp: new Date(),
    };

    shouldAutoScrollRef.current = true;
    const nextMessagesForSend = [...messages, userMessage];
    setMessages(nextMessagesForSend);
    persistSnapshotRef.current = {
      ...persistSnapshotRef.current,
      messages: nextMessagesForSend,
    };
    const currentInput = input;
    const currentImages = [...allImages]; // ??????????????
    if (!chatIdRef.current) {
      sessionDisplayModelRef.current = normalizeModelId(selectedModel);
    }
    const currentChatIdForActivity = ensureConversationSessionId();
    if (currentChatIdForActivity) {
      onChatActivity?.(currentChatIdForActivity, {
        modelId: sessionDisplayModelRef.current,
      });
    }

    // ?? blob URL ????????????????? revoke?
    const blobUrlsToKeep = new Set<string>();
    attachedImages.forEach(url => {
      if (url.startsWith('blob:')) {
        blobUrlsToKeep.add(url);
      }
    });
    
    // ????????????????????????????"????"??
    if (allImages.length > 0) {
      setReferencedImages([...allImages]);
      if (!referencedImage && allImages.length > 0) {
        setReferencedImage(allImages[0]);
      }
    }
    setAttachedImages([]);
    setInput('');
    setIsLoading(true);

    try {
      const usedModel = await attemptSendWithFallback(
        selectedModel,
        currentInput,
        currentImages,
        currentChatIdForActivity,
        userMessage.id
      );
      if (normalizeModelId(usedModel) !== normalizeModelId(selectedModel)) {
        setSelectedModel(usedModel);
      }
      commitTurnSession(currentChatIdForActivity, currentInput, usedModel);
    } catch (error) {
      let errorMessage = '**❌ API 调用失败**\n\n抱歉，分析过程中出现错误。';
      let derivedRequestId: string | undefined;

      if (error instanceof Error) {
        if (
          error.message.includes('API') ||
          error.message.includes('HTTP') ||
          error.message.includes('Gemini') ||
          error.message.includes('Claude') ||
          error.message.includes('AITop100') ||
          error.message.includes('????')
        ) {
          errorMessage = error.message;
        } else if (axios.isAxiosError(error)) {
          if (error.code === 'ECONNABORTED') {
            errorMessage = formatQwenFailure(
              `**原因：** 请求超时（${QWEN_AXIOS_TIMEOUT_MS / 1000} 秒内未完成）。Qwen 大模型首包可能较慢，请稍后重试或联系 IT 检查代理到 models.fangte.com 的连通性。`
            );
          } else if (error.response) {
            const responseData = error.response.data;
            const hdr = error.response.headers as Record<string, string | undefined> | undefined;
            derivedRequestId =
              hdr?.['x-request-id'] ||
              hdr?.['x-trace-id'] ||
              hdr?.['request-id'] ||
              hdr?.['trace-id'] ||
              derivedRequestId;
            if (selectedModel === 'qwen') {
              errorMessage = formatQwenFailure(
                buildQwenHttpErrorDetail(
                  error.response.status,
                  error.response.statusText || '',
                  responseData
                )
              );
            } else {
              let detail = `**HTTP状态：** ${error.response.status} ${error.response.statusText || ''}\n\n`;
              if (responseData?.error) {
                detail += `**错误类型：** ${responseData.error.type || '未知'}\n`;
                detail += `**错误消息：** ${responseData.error.message || '无详细错误信息'}\n`;
                if (responseData.error.code) {
                  detail += `**错误代码：** ${responseData.error.code}\n`;
                }
              } else if (responseData?.message) {
                detail += `**错误消息：** ${responseData.message}\n`;
              } else if (responseData?.msg) {
                detail += `**错误消息：** ${responseData.msg}\n`;
              } else if (typeof responseData === 'object') {
                detail += `**错误详情：**\n\`\`\`json\n${JSON.stringify(responseData, null, 2)}\n\`\`\`\n`;
              } else {
                detail += `**错误详情：** ${String(responseData)}\n`;
              }
              errorMessage = formatQwenFailure(detail);
            }
          } else if (error.request) {
            errorMessage = formatAitopLlmFailure(
              '对话接口',
              `**问题：** 无法收到服务器响应（无 response）。\n**可能原因：** 网络、代理或服务端未应答。\n**代码：** ${error.code || '—'}`
            );
          } else {
            errorMessage = formatAitopLlmFailure('对话接口', `**问题：** ${error.message}`);
          }
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = `**❌ 未知错误**\n\n**错误信息：** ${String(error)}\n\n**建议：** 请稍后重试或联系技术支持。`;
      }

      if (!errorMessage.includes('**❌')) {
        errorMessage = `**❌ API 调用失败**\n\n${errorMessage}`;
      }
      errorMessage = appendErrorIds(errorMessage, {
        chatId: currentChatIdForActivity || chatIdRef.current,
        requestId: derivedRequestId,
      });
      
      const errorMsg: ChatMessage = {
        id: 'error-' + Date.now(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date()
      };

      setMessages((prev) => {
        let next = prev.filter(
          (m) =>
            !(
              m.role === 'assistant' &&
              m.content === '' &&
              String(m.id).startsWith('assistant-')
            )
        );
        next = pruneTurnToSingleAssistantReply(next, userMessage.id);
        next = [...next, errorMsg];
        persistSnapshotRef.current = {
          ...persistSnapshotRef.current,
          messages: next,
        };
        return next;
      });
      commitTurnSession(currentChatIdForActivity, currentInput);
    } finally {
      setIsLoading(false);
    }
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleSendPresetToModel = async (presetName: string, presetContent: string) => {
    if (isLoading) return;
    const text = (presetContent || '').trim();
    if (!text) {
      setContextMenu(null);
      return;
    }

    const userMessage: ChatMessage = {
      id: `preset-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    shouldAutoScrollRef.current = true;
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    persistSnapshotRef.current = {
      ...persistSnapshotRef.current,
      messages: nextMessages,
    };
    setContextMenu(null);

    if (!chatIdRef.current) {
      sessionDisplayModelRef.current = normalizeModelId(selectedModel);
    }
    const currentChatIdForActivity = ensureConversationSessionId();
    onChatActivity?.(currentChatIdForActivity, {
      modelId: sessionDisplayModelRef.current,
    });

    setIsLoading(true);
    try {
      const usedModel = await attemptSendWithFallback(
        selectedModel,
        text,
        [],
        currentChatIdForActivity,
        userMessage.id
      );
      if (normalizeModelId(usedModel) !== normalizeModelId(selectedModel)) {
        setSelectedModel(usedModel);
      }
      commitTurnSession(currentChatIdForActivity, text, usedModel);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : `**❌ ${presetName} 发送失败**\n\n${String(error)}`;
      setMessages((prev) => {
        let next = prev.filter(
          (m) =>
            !(
              m.role === 'assistant' &&
              m.content === '' &&
              String(m.id).startsWith('assistant-')
            )
        );
        next = pruneTurnToSingleAssistantReply(next, userMessage.id);
        next = [
          ...next,
          {
            id: `preset-error-${Date.now()}`,
            role: 'assistant' as const,
            content: errorMessage.includes('**❌')
              ? errorMessage
              : `**❌ ${presetName} 发送失败**\n\n${errorMessage}`,
            timestamp: new Date(),
          },
        ];
        persistSnapshotRef.current = {
          ...persistSnapshotRef.current,
          messages: next,
        };
        return next;
      });
      commitTurnSession(currentChatIdForActivity, text);
    } finally {
      setIsLoading(false);
    }
  };

  // AiTop llm/see（Gemini / Claude / DeepSeek / DouBao 共用）
  const handleAitopLlmSend = async (
    uiModelId: string,
    currentInput: string,
    currentImages: string[],
    forcedChatId?: string,
    retryCount = 0,
    retryOptions?: LlmSendRetryOptions
  ) => {
    const modelDef = getAitopChatModel(uiModelId);
    if (!modelDef) {
      throw new Error(`未注册的 AiTop 聊天模型: ${uiModelId}`);
    }
    const modelLabel = modelDef.displayLabel;
    const apiModelName = modelDef.apiModelName;
    const timeoutFamily = modelDef.timeoutFamily;
    const modelSlug = modelDef.logSlug;
    const degradedAfterSwitch =
      degradedOnceAfterModelSwitchRef.current && retryOptions?.degraded !== true;
    const useDegraded = retryOptions?.degraded === true || degradedAfterSwitch;
    const lightweight = currentImages.length === 0 && isLightweightPrompt(currentInput || '');
    if (currentImages.length > 6) {
      throw new Error(
        formatAitopLlmFailure(
          modelLabel,
          '**参数校验：** 图片最多支持 6 张，请减少后重试。'
        )
      );
    }
    
    const forcedWebSearchOffGemini = retryOptions?.forceWebSearchOff === true;
    // ?????Gemini API ?? message ??? markdown ??
    let imageTail = '';
    if (currentImages.length > 0) {
      try {
        const processedImageUrls = await Promise.all(
          currentImages.map(async (imageUrl, index) => {
            try {
              return await processImageUrl(imageUrl);
            } catch (error) {
              throw new Error(`第 ${index + 1} 张图片处理失败: ${error instanceof Error ? error.message : String(error)}`);
            }
          })
        );
        processedImageUrls.forEach((imageUrl, index) => {
          if (index === 0) {
            imageTail += `\n<p>![](${imageUrl})</p>`;
          } else {
            imageTail += `<p>![](${imageUrl})</p>`;
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`图片处理失败: ${errorMessage}`);
      }
    }
    const forcedWebSearchOff = forcedWebSearchOffGemini;
    const keepWebSearchOnDegradedRetry =
      retryOptions?.degraded === true && useWebSearch && !forcedWebSearchOff;
    // 轻量问候等：即使 UI 开着联网，本轮也不走检索首轮（避免历史话题污染）
    const effectiveWebSearch = forcedWebSearchOff
      ? false
      : keepWebSearchOnDegradedRetry
        ? true
        : (useDegraded || lightweight ? false : useWebSearch);
    const isGeminiWebSearchFirstPass =
      !!effectiveWebSearch && !retryOptions?.summarizeSearchDumpText;
    // 联网搜索复用当前对话 chatId（借鉴 FastChat 会话持久化），保留上下文连续性
    let currentChatId = forcedChatId || generateChatId();
    if (isGeminiWebSearchFirstPass && !chatIdRef.current) {
      // 仅在全新对话（无现有 chatId）时创建临时 ID；已有对话则复用原 chatId
      currentChatId = createEphemeralChatId();
    }
    const baseMessage = buildAitopMessageWithHistory(
      persistSnapshotRef.current.messages,
      currentInput || '',
      imageTail,
      { webSearch: effectiveWebSearch, skillBlock: resolveProjectSkillBlock() }
    );
    const webDialogueCtx = buildWebSearchDialogueContext(
      persistSnapshotRef.current.messages,
      currentInput || ''
    );
    let message: string;
    let geminiWebSearchQuery = '';
    if (retryOptions?.continuationContext) {
      // 长输出自动续写：不携带历史，只用原问题 + 已输出尾部
      message = buildContinuationPrompt(
        retryOptions.continuationContext.originalInput,
        retryOptions.continuationContext.priorContent
      );
    } else if (retryOptions?.summarizeSearchDumpText) {
      message = buildSearchDumpSummarizePrompt(currentInput || '', retryOptions.summarizeSearchDumpText, {
        compact: !!retryOptions.summarizeCompact,
        dialogueContext: webDialogueCtx,
        skillBlock: resolveProjectSkillBlock(),
      });
    } else if (isGeminiWebSearchFirstPass) {
      // 复用缓存：避免 fallback 链中每次重试都重新调用 probe（每次约 10s 超时）
      let probeQuery: string;
      if (webSearchProbeCacheRef.current !== null) {
        probeQuery = webSearchProbeCacheRef.current;
        console.warn('[chat] web search probe using cached result', { query: probeQuery.slice(0, 120) });
      } else {
        const probeRewriteChatId = createEphemeralChatId();
        probeQuery = await resolveWebSearchProbeMessageForAitop(
          {
            url: AITOP_LLM_API.URL,
            apiKey: AITOP_LLM_API.API_KEY,
            model: apiModelName,
          },
          persistSnapshotRef.current.messages,
          currentInput || '',
          imageTail,
          probeRewriteChatId
        );
        webSearchProbeCacheRef.current = probeQuery;
      }
      geminiWebSearchQuery = probeQuery;
      message = probeQuery;
    } else {
      message = baseMessage;
    }
    
                // ??????
    const headers = {
      'api-key': AITOP_LLM_API.API_KEY,
      'Content-Type': 'application/json'
    };
    
    // Gemini 3.1 Pro: thinking ?? + thinkingLevel=low/high
    const payload: any = {
      id: normalizeAitopChatId(currentChatId),
      message: message,
      model: apiModelName,
      tip: ' ',
      webSearch: effectiveWebSearch,
      stream: true, // 借鉴 FastChat：请求上游流式输出，降低 TTFB 感知延迟
    };
    
    const isSummarizeRetry = !!retryOptions?.summarizeSearchDumpText;
    const thinkingEnabledForTurn = thinkingMode !== 'off';
    // 联网总结二次 pass：仍尊重用户思考开关，禁止「仅开联网」却强制 thinking:true
    if (isSummarizeRetry) {
      payload.thinking = thinkingEnabledForTurn;
      payload.thinkingLevel =
        payload.thinking && !useDegraded && thinkingMode === 'deep' ? 'high' : 'low';
    } else {
      payload.thinkingLevel =
        !useDegraded && !lightweight && thinkingMode === 'deep' ? 'high' : 'low';
      payload.thinking = thinkingEnabledForTurn;
    }
    payload.tip = buildAitopTip({
      thinking: !!payload.thinking,
      webSearch: !!effectiveWebSearch,
      webSearchFirstPass: isGeminiWebSearchFirstPass,
      skillTip: buildProjectSkillAitopTip(projectSkillRef.current),
      modelLabel,
      identityQuestion: isAssistantIdentityQuestion(currentInput || ''),
    });
    const aitopTimeoutOpts = {
      useDegraded,
      isSummarize: isSummarizeRetry,
      effectiveWebSearch,
      payloadCharLen: String(message).length,
    };
    const geminiFetchTimeoutMs = resolveAitopFetchTimeoutMs(timeoutFamily, aitopTimeoutOpts);
    const geminiStreamIdleTimeoutMs = resolveAitopStreamIdleTimeoutMs(thinkingMode, aitopTimeoutOpts);
    const aitopRequestUrl =
      typeof window !== 'undefined'
        ? new URL(AITOP_LLM_API.URL, window.location.origin).href
        : AITOP_LLM_API.URL;
    logChatLlmPreload({
      model: modelLabel,
      url: aitopRequestUrl,
      upstreamUrl: `${AITOP_LLM_API.BASE_URL}/api/v1/llm/see`,
      headers,
      body: payload,
    });
    
    
    // ?? Assistant ?????????????
    const continuationCtx = retryOptions?.continuationContext;
    const assistantMessageId = continuationCtx?.assistantMessageId || ('assistant-' + Date.now());
    if (!continuationCtx) {
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages(prev => [...prev, assistantMessage]);
    }
    
    let upstreamRequestId: string | undefined;
    let fullContent = continuationCtx?.priorContent || '';
    let fullReasoning = continuationCtx?.priorReasoning || '';
    try {
      const ac = new AbortController();
      const fetchTimer = window.setTimeout(() => ac.abort(), geminiFetchTimeoutMs);
      let response: Response;
      try {
        response = await fetch(AITOP_LLM_API.URL, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        upstreamRequestId = pickRequestIdFromHeaders(response.headers);
        // 检测 relay 层重试（server.js 在 502/504 时重试一次），用于诊断慢首包
        if (response.headers.get('x-relay-retry') === '1') {
          console.warn(`[chat][${modelLabel}] relay 层重试了一次（502/504），首包可能偏慢`);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new Error(
            formatAitopErr(
              modelLabel,
              `**原因：** ${geminiFetchTimeoutMs / 1000} 秒内未完成连接或首包（请求已中止）。请稍后重试。`,
              { chatId: currentChatId }
            )
          );
        }
        throw new Error(
          formatAitopErr(
            modelLabel,
            `**问题：** ${e instanceof Error ? e.message : String(e)}`,
            { chatId: currentChatId }
          )
        );
      } finally {
        window.clearTimeout(fetchTimer);
      }

      const jsonErrGemini = await readAitopJsonErrorIfAny(response);
      if (jsonErrGemini) {
        throw new Error(
          formatAitopErr(modelLabel, `**问题：** ${jsonErrGemini}`, {
            chatId: currentChatId,
            requestId: upstreamRequestId,
          })
        );
      }

      if (!response.ok) {
        const requestId = mergeAitopRequestId(upstreamRequestId, pickRequestIdFromHeaders(response.headers));
        upstreamRequestId = requestId;
        let responseTaskId: string | undefined;
        let errorDetail = '';
        try {
          const errorData = await response.json();
          responseTaskId =
            errorData?.taskId ||
            errorData?.requestId ||
            errorData?.request_id ||
            errorData?.data?.taskId ||
            errorData?.data?.requestId ||
            errorData?.data?.request_id;
          if (errorData.error) {
            errorDetail = `\n**错误类型：** ${errorData.error.type || '未知'}\n**错误消息：** ${errorData.error.message || '无详细错误信息'}`;
            if (errorData.error.code) {
              errorDetail += `\n**错误代码：** ${errorData.error.code}`;
            }
          } else if (errorData.message) {
            errorDetail = `\n**错误消息：** ${errorData.message}`;
          } else if (errorData.msg) {
            errorDetail = `\n**错误消息：** ${errorData.msg}`;
          } else {
            errorDetail = `\n**错误详情：** ${JSON.stringify(errorData, null, 2)}`;
          }
        } catch {
          try {
            const errorText = await response.text();
            errorDetail = `\n**错误详情：** ${errorText}`;
          } catch {
            errorDetail = `\n**状态码：** ${response.status}\n**状态文本：** ${response.statusText}`;
          }
        }
        throw new Error(
          formatAitopErr(
            modelLabel,
            `**HTTP状态：** ${response.status} ${response.statusText}${errorDetail}`,
            { chatId: currentChatId, requestId, taskId: responseTaskId }
          )
        );
      }

      if (!response.body) {
        throw new Error(
          formatAitopErr(modelLabel, '**问题：** 响应体为空，服务器未返回任何数据', {
            chatId: currentChatId,
            requestId: upstreamRequestId,
          })
        );
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      fullContent = '';
      fullReasoning = '';
      let buffer = '';

      const collectApiReasoning = thinkingEnabledForTurn;
      const guardContentOpts = {
        userQuestion: currentInput || '',
        webSearchEnabled: isSummarizeRetry ? useWebSearch && !lightweight : effectiveWebSearch,
        thinkingEnabled: thinkingEnabledForTurn,
      };

      // 借鉴 FastChat/llama.cpp：数据到达即显示
      // 关键修复：用 requestAnimationFrame 合并渲染，并配合读取循环每轮让出主线程到绘制步骤。
      // 旧版 30ms Date.now() 节流在"微任务自旋"下永远到不了浏览器绘制步骤，导致最后一起刷新。
      let rafPending = false;

      // 流式过程中：轻量渲染，直接用原始 fullContent，跳过 finalizeAssistantMessageContent 的重解析
      // （表格抽取 / 分段重组统一交给流结束时的 updateStreamUI 处理，保证最终展示正确）
      const renderStreamingLightweight = () => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: fullContent, isStreaming: true }
              : msg
          )
        );
      };

      // 流结束：完整解析（表格抽取 / 分段重组），保证最终展示正确
      const updateStreamUI = () => {
        const finalized = finalizeAssistantMessageContent(fullContent);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: finalized.content,
                  tableRows: finalized.tableRows,
                  isStreaming: true,
                }
              : msg
          )
        );
      };

      // 一帧最多渲染一次，且回调在绘制步骤执行，确保逐帧可见
      const flushStreamUiIfDue = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          renderStreamingLightweight();
        });
      };

      const flushStreamUiImmediate = () => {
        rafPending = false;
        updateStreamUI();
      };

      const cleanupReveal = () => {
        // 兼容旧调用：立即刷新 UI 显示完整内容
        flushStreamUiImmediate();
      };

      let geminiDoneByFlag = false;
      let geminiFinishReason: string | undefined;
      const handleGeminiStreamData = (data: any) => {
        const apiErr = extractAitopApiErrorFromPayload(data);
        if (apiErr) {
          throw new Error(
            formatAitopErr(
              modelLabel,
              `**问题：** ${apiErr}${modelDef.useGeminiUnavailableHint ? aitopGeminiUnavailableHint(data) : ''}`,
              { chatId: currentChatId, requestId: upstreamRequestId }
            )
          );
        }
        upstreamRequestId = mergeAitopRequestId(
          upstreamRequestId,
          pickRequestIdFromStreamPayload(data)
        );
        const contentChunk = getStreamContentChunk(data);
        if (contentChunk) {
          fullContent += contentChunk;
          flushStreamUiIfDue();
        }
        if (collectApiReasoning) {
          const reasoningChunk = getStreamReasoningChunk(data);
          if (reasoningChunk) fullReasoning += reasoningChunk;
        }
        if (data.error) {
          let errorMsg = `**错误类型：** ${data.error.type || '未知'}\n**错误消息：** ${data.error.message || '无详细错误信息'}`;
          if (data.error.code) {
            errorMsg += `\n**错误代码：** ${data.error.code}`;
          }
          throw new Error(
            formatAitopErr(modelLabel, errorMsg, {
              chatId: currentChatId,
              requestId: upstreamRequestId,
            })
          );
        }
        const fr = getAitopStreamFinishReason(data);
        if (fr) geminiFinishReason = fr;
        if (data.isDone) geminiDoneByFlag = true;
      };

      while (true) {
        const { done, value } = await readStreamChunkWithIdle(
          reader,
          geminiStreamIdleTimeoutMs,
          () =>
            new Error(
              formatAitopErr(
                modelLabel,
                `**问题：** 流式输出在 ${geminiStreamIdleTimeoutMs / 1000} 秒内无新数据，连接可能已中断。请稍后重试。`,
                { chatId: currentChatId, requestId: upstreamRequestId }
              )
            )
        );

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // ????SSE????
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // ?????????

        for (const line of lines) {
          const payloadLine = parseStreamPayloadLine(line);
          if (!payloadLine) continue;
          try {
            const data = JSON.parse(payloadLine);
            handleGeminiStreamData(data);
            if (geminiDoneByFlag) break;
          } catch (e) {
            if (isAitopFormattedStreamError(e)) {
              throw e;
            }
            warnChatSseLineParseSkipped(modelLabel, payloadLine, e);
          }
        }
        // 关键：每批处理完让出主线程到绘制步骤，防止微任务自旋导致"最后一起刷新"
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (geminiDoneByFlag) break;
      }

                // ??????
      const geminiTailPayload = parseStreamPayloadLine(buffer);
      if (geminiTailPayload) {
        try {
          const data = JSON.parse(geminiTailPayload);
          handleGeminiStreamData(data);
        } catch (e) {
          if (isAitopFormattedStreamError(e)) {
            throw e;
          }
          warnChatSseLineParseSkipped(modelLabel, geminiTailPayload, e);
        }
      }

      let geminiStreamContent = fullContent;
      if (!thinkingEnabledForTurn && (fullReasoning || '').trim() && !(fullContent || '').trim()) {
        geminiStreamContent = fullReasoning;
      }

      let composedGemini = composeStreamedAssistantMessage(
        geminiStreamContent,
        fullReasoning,
        collectApiReasoning,
        geminiWebSearchQuery,
        effectiveWebSearch,
        guardContentOpts
      );
      if (retryOptions?.summarizeSearchDumpText) {
        composedGemini = mergeWithWebSearchProcess(
          composedGemini,
          retryOptions.summarizeSearchDumpText,
          fullReasoning,
          collectApiReasoning,
          { userQuestion: currentInput || '' }
        );
      }
      const finalContentRaw = clipMessageContent(composedGemini);
      const geminiWebFirstPass =
        effectiveWebSearch && !retryOptions?.summarizeSearchDumpText
          ? prepareWebSearchFirstPassContent(finalContentRaw, currentInput || '')
          : {
              content: finalContentRaw,
              sections: parseAssistantMessage(finalContentRaw),
              needsSummarize: false,
            };
      let finalContent = guardAssistantReplyContent(geminiWebFirstPass.content, {
        synthesizedRaw: geminiStreamContent || composedGemini,
        ...guardContentOpts,
      });
      warnIfLlmSeeLikelyUpstreamFallback(modelLabel, finalContent);

      // finish_reason 追踪（借鉴 FastChat）：当流因 max_tokens 截断时追加提示
      if (geminiFinishReason === 'length') {
        finalContent += `\n\n⚠️ **输出已达上限被截断。** 如需完整内容，请缩小单次提问范围或分批发送。`;
      }

      const geminiUpstreamFallback = detectUpstreamFallback({
        content: fullContent,
        reasoning: fullReasoning,
        combined: finalContent,
      });
      if (geminiUpstreamFallback) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
        if (!useDegraded && retryCount < 1) {
          const retryChatId = createEphemeralChatId();
          console.warn(`[chat][${modelLabel}] fallback quick degraded retry once`, {
            chatId: currentChatId,
            retryChatId,
            fallbackText: finalContent.slice(0, 200),
          });
          await handleAitopLlmSend(uiModelId, currentInput, currentImages, retryChatId, retryCount, {
            degraded: true,
            forceWebSearchOff: true,
          });
          return;
        }
        if (FAST_SWITCH_ON_UPSTREAM_FALLBACK) {
          throw new Error(
            formatAitopErr(
              modelLabel,
              `**原因：** ${clipMessageContent(fullContent || finalContent).slice(0, 200)}\n**说明：** 检测到上游临时兜底文案，将自动尝试切换其他模型继续回答。`,
              { chatId: currentChatId, requestId: upstreamRequestId }
            )
          );
        }
        throw new Error(
          formatAitopErr(
            modelLabel,
            `**原因：** ${clipMessageContent(fullContent || finalContent).slice(0, 200)}\n**说明：** 检测到上游临时兜底文案，建议改选 Qwen 或稍后重试。`,
            { chatId: currentChatId, requestId: upstreamRequestId }
          )
        );
      }

      const geminiPostSections = parseAssistantMessage(finalContent);
      const shouldRetrySummarizeGemini =
        !retryOptions?.summarizeSearchDumpText &&
        (retryOptions?.summarizeRetryCount ?? 0) < 1 &&
        effectiveWebSearch &&
        (geminiWebFirstPass.needsSummarize ||
          needsWebSearchSynthesisPass(geminiPostSections, currentInput || '') ||
          isLikelyMainOnlySearchDump(geminiPostSections.main));
      if (shouldRetrySummarizeGemini) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
        const dumpText = geminiWebFirstPass.content;
        const runGeminiSummarize = async (compact: boolean) => {
          const retryChatId = createEphemeralChatId();
          console.warn(`[chat][${modelLabel}] web search answer unstable/too short, retry summarize-only`, {
            chatId: currentChatId,
            retryChatId,
            compact,
            preview: dumpText.slice(0, 200),
          });
          await handleAitopLlmSend(uiModelId, currentInput, currentImages, retryChatId, retryCount + 1, {
            degraded: false,
            forceWebSearchOff: true,
            summarizeSearchDumpText: dumpText,
            summarizeRetryCount: (retryOptions?.summarizeRetryCount ?? 0) + 1,
            summarizeCompact: compact,
          });
        };
        try {
          await runGeminiSummarize(false);
        } catch (summarizeErr) {
          const summarizeMsg =
            summarizeErr instanceof Error ? summarizeErr.message : String(summarizeErr);
          if (/首包|abort|AbortError/i.test(summarizeMsg) && !retryOptions?.summarizeCompact) {
            console.warn(`[chat][${modelLabel}] summarize timeout, retry compact`, {
              chatId: currentChatId,
              preview: summarizeMsg.slice(0, 120),
            });
            await runGeminiSummarize(true);
          } else {
            throw summarizeErr;
          }
        }
        return;
      }

      finalContent = guardAssistantReplyContent(finalContent, {
        synthesizedRaw: geminiStreamContent || composedGemini,
        ...guardContentOpts,
      });
      let finalized = finalizeAssistantMessageContent(finalContent);
      const visibilityOpts = {
        ...guardContentOpts,
        rawFallback: geminiStreamContent || fullContent,
      };
      let geminiHasVisibleMain =
        assistantReplyHasVisibleMain(finalized.content, visibilityOpts) ||
        !!(finalized.tableRows && finalized.tableRows.length > 0);
      if (!geminiHasVisibleMain && (geminiStreamContent || '').trim().length >= 32) {
        const recovered = recoverAssistantReplyFromRaw(geminiStreamContent, {
          ...guardContentOpts,
          userQuestion: currentInput || '',
        });
        const recoveredFinal = finalizeAssistantMessageContent(recovered);
        if (
          assistantReplyHasVisibleMain(recoveredFinal.content, guardContentOpts) ||
          !!(recoveredFinal.tableRows && recoveredFinal.tableRows.length > 0)
        ) {
          finalContent = recovered;
          finalized = recoveredFinal;
          geminiHasVisibleMain = true;
        }
      }
      if (!geminiHasVisibleMain) {
        throw new Error(
          formatAitopErr(
            modelLabel,
            '**问题：** 模型未返回有效正文或表格内容。',
            { chatId: currentChatId, requestId: upstreamRequestId }
          )
        );
      }
      // 停止逐字动画，由下方 setMessages 闪现完整内容
      cleanupReveal();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: finalized.content,
                tableRows: finalized.tableRows,
                isStreaming: false,
              }
            : msg
        )
      );

      
    } catch (error) {
      // 改进4：空响应(0字)同模型重试（借鉴 grok-build AttemptOutcome::Empty）
      const isEmptyResponse = (fullContent || '').trim().length === 0
        && (fullReasoning || '').trim().length === 0;
      if (isEmptyResponse && !continuationCtx && retryCount < AITOP_EMPTY_RESPONSE_RETRY_MAX) {
        // 移除空的 assistant 消息后同模型重试
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
        try {
          await handleAitopLlmSend(
            uiModelId,
            currentInput,
            currentImages,
            forcedChatId,
            retryCount + 1,
            retryOptions
          );
          return;
        } catch (retryError) {
          throw retryError;
        }
      }

      // 长输出自动续写：流中断且已输出较长时，同模型继续输出而非切换模型
      const continuationRound = continuationCtx?.round || 0;
      if (isContinuableStreamError(error, (fullContent || '').length, continuationRound)) {
        // 改进1：续写视觉提示（借鉴 grok-build Retrying 事件通知 UI）
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: (msg.content || '') + '\n\n> ⏳ 正在继续输出…' }
            : msg
        ));
        // 改进3：续写前小延迟（借鉴 LangChain wait_exponential 指数退避思路，给上游恢复窗口）
        // 第 N 轮续写延迟 N * AITOP_CONTINUATION_DELAY_MS（递增退避）
        const continuationDelayMs = AITOP_CONTINUATION_DELAY_MS * (continuationRound + 1);
        if (continuationDelayMs > 0) {
          await new Promise(r => setTimeout(r, continuationDelayMs));
        }
        // 续写时复用同一条 assistant 消息，fullContent 已包含 priorContent
        try {
          await handleAitopLlmSend(
            uiModelId,
            continuationCtx?.originalInput || currentInput,
            currentImages,
            forcedChatId,
            retryCount,
            {
              ...retryOptions,
              continuationContext: {
                round: continuationRound + 1,
                priorContent: fullContent,
                priorReasoning: fullReasoning,
                originalInput: continuationCtx?.originalInput || currentInput || '',
                assistantMessageId,
              },
            }
          );
          return; // 续写成功，不 throw
        } catch (continuationError) {
          // 续写也失败：递归调用内部已处理 preserveIncompleteStreamOnError，
          // 直接 re-throw 跳过本层重复处理，让外层 fallback 接管
          throw continuationError;
        }
      }
      const partialChars = preserveIncompleteStreamOnError({
        modelLabel,
        modelSlug,
        fullContent,
        fullReasoning,
        collectReasoning: thinkingMode !== 'off',
        allowWebSearchExtractFromMain: effectiveWebSearch,
        webSearchEnabled: retryOptions?.summarizeSearchDumpText
          ? useWebSearch && !lightweight
          : effectiveWebSearch,
        thinkingEnabled: thinkingMode !== 'off',
        userQuestion: currentInput || '',
        assistantMessageId,
        setMessages,
        error,
      });
      lastFailedStreamCharsRef.current = Math.max(
        lastFailedStreamCharsRef.current,
        partialChars
      );

      // 流中断保留已输出内容（借鉴 FastChat 流内错误嵌入）：
      // 当已输出较长内容时，直接保留已输出内容 + 中断提示，不再切换模型
      const shouldPreservePartial = (fullContent || '').trim().length >= 200;
      if (shouldPreservePartial) {
        const finalized = finalizeAssistantMessageContent(
          (fullContent || '') + '\n\n---\n> ⚠️ **回复中断**：流式输出在传输过程中意外中断，以上为已获取的部分内容。'
        );
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: finalized.content,
                  tableRows: finalized.tableRows,
                  isStreaming: false,
                }
              : msg
          )
        );
        return; // 保留部分内容，不触发 fallback 切换模型
      }

      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        formatAitopErr(modelLabel, `**问题：** ${String(error)}`, {
          chatId: currentChatId,
          requestId: upstreamRequestId,
        })
      );
    } finally {
      if (degradedAfterSwitch) endDegradedModelSwitch();
    }
  };

  // Qwen API????
  const handleQwenSend = async (
    currentInput: string,
    currentImages: string[],
    forcedChatId?: string,
    retryCount = 0,
    sendOpts?: { fromFallback?: boolean }
  ) => {
    const modelStartedAt = Date.now();
    const degradedAfterSwitch = degradedOnceAfterModelSwitchRef.current;
    const currentChatId = forcedChatId || generateChatId();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QWEN_API_CONFIG.API_KEY}`,
    };

    const userText =
      currentInput ||
      (currentImages.length > 0 ? `请分析这 ${currentImages.length} 张图片` : '请描述你的问题');
    const lightweight = currentImages.length === 0 && isLightweightPrompt(userText);
    const hasImages = currentImages.length > 0;
    const qwenApiUrl = QWEN_API_CONFIG.URL;

    // 与 1229 一致：user content 用 multimodal 数组（纯文本也含 type:text）
    let currentUserContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: userText },
    ];
    if (hasImages) {
      try {
        const processedImageUrls = await Promise.all(
          currentImages.map(async (imageUrl, index) => {
            try {
              return await processImageUrl(imageUrl);
            } catch (error) {
              throw new Error(`图片 ${index + 1} 处理失败: ${error instanceof Error ? error.message : String(error)}`);
            }
          })
        );
        processedImageUrls.forEach((imageUrl) => {
          currentUserContent.push({ type: 'image_url', image_url: { url: imageUrl } });
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`图片处理失败: ${errorMessage}`);
      }
    }

    const qwenMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }> = [];
    const qwenSkillBlock = buildProjectSkillBlock(projectSkillRef.current);
    if (qwenSkillBlock) {
      qwenMessages.push({ role: 'system', content: qwenSkillBlock });
    }

    const historyMessages = persistSnapshotRef.current.messages
      .filter((m) => !isMetaChatMessage(m) && m.content?.trim())
      .slice(-12);

    for (const msg of historyMessages) {
      // ?????????????user??????????
      if (msg.role === 'user' && msg.content.trim() === userText.trim()) continue;
      
      if (msg.role === 'assistant') {
        const cleanContent = sanitizeContentForCrossModelHistory(msg.content);
        if (cleanContent) {
          qwenMessages.push({ role: 'assistant', content: cleanContent });
        }
      } else {
        qwenMessages.push({ role: 'user', content: msg.content.trim() });
      }
    }

    if (lightweight) {
      qwenMessages.length = 0;
      if (qwenSkillBlock) {
        qwenMessages.push({ role: 'system', content: qwenSkillBlock });
      }
    }

    qwenMessages.push({ role: 'user', content: currentUserContent });

    const qwenMaxTokens = resolveQwenMaxTokens({
      lightweight,
      hasImages,
      userTextLen: userText.length,
      skillActive: isProjectSkillActive(projectSkillRef.current),
      fromFallback: sendOpts?.fromFallback,
    });

    const payload: any = {
      model: QWEN_API_CONFIG.MODEL_NAME,
      messages: qwenMessages,
      max_tokens: qwenMaxTokens,
      stream: true,
    };

    logChatLlmPreload({
      model: 'Qwen',
      url:
        typeof window !== 'undefined'
          ? new URL(qwenApiUrl, window.location.origin).href
          : qwenApiUrl,
      upstreamUrl: 'https://models.fangte.com/v1/chat/completions',
      headers: headers as Record<string, string>,
      body: payload,
    });

    const assistantMessageId = 'assistant-' + Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      },
    ]);

    let fullContent = '';
    const qwenTimeoutMs = lightweight ? QWEN_AXIOS_TIMEOUT_LIGHT_MS : QWEN_AXIOS_TIMEOUT_MS;
    const qwenStreamIdleMs = 120_000;

    try {
      const ac = new AbortController();
      const fetchTimer = window.setTimeout(() => ac.abort(), qwenTimeoutMs);
      let response: Response;
      try {
        response = await fetch(qwenApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new Error(
            formatQwenFailure(
              `**原因：** ${qwenTimeoutMs / 1000} 秒内未完成连接或首包（请求已中止）。请稍后重试。`
            )
          );
        }
        throw e;
      } finally {
        window.clearTimeout(fetchTimer);
      }

      if (!response.ok) {
        let errData: unknown = null;
        try {
          errData = await response.json();
        } catch {
          try {
            errData = await response.text();
          } catch {
            errData = null;
          }
        }
        throw new Error(
          formatQwenFailure(
            buildQwenHttpErrorDetail(response.status, response.statusText || '', errData)
          )
        );
      }

      if (!response.body) {
        throw new Error(formatQwenFailure('**问题：** 响应体为空，无法读取流式输出。'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finishReason: string | undefined;

      // 借鉴 FastChat/llama.cpp：数据到达即显示
      // 关键修复：用 requestAnimationFrame 合并渲染，并配合读取循环每轮让出主线程到绘制步骤。
      // 旧版 30ms Date.now() 节流在"微任务自旋"下永远到不了浏览器绘制步骤，导致最后一起刷新。
      let rafPending = false;

      // 流式过程中：轻量渲染，直接用原始 fullContent，跳过 finalizeAssistantMessageContent 的重解析
      // （表格抽取 / 分段重组统一交给流结束时的 updateStreamUI 处理，保证最终展示正确）
      const renderStreamingLightweight = () => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: fullContent, isStreaming: true }
              : msg
          )
        );
      };

      // 流结束：完整解析（表格抽取 / 分段重组），保证最终展示正确
      const updateStreamUI = () => {
        const finalized = finalizeAssistantMessageContent(fullContent);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: finalized.content,
                  tableRows: finalized.tableRows,
                  isStreaming: true,
                }
              : msg
          )
        );
      };

      // 一帧最多渲染一次，且回调在绘制步骤执行，确保逐帧可见
      const flushStreamUiIfDue = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          renderStreamingLightweight();
        });
      };

      const flushStreamUiImmediate = () => {
        rafPending = false;
        updateStreamUI();
      };

      const cleanupReveal = () => {
        // 兼容旧调用：立即刷新 UI 显示完整内容
        flushStreamUiImmediate();
      };

      const consumeQwenSseLine = (line: string) => {
        const payloadLine = parseStreamPayloadLine(line);
        if (!payloadLine) return;
        try {
          const data = JSON.parse(payloadLine);
          const chunk = getQwenStreamDeltaContent(data);
          if (chunk) {
            fullContent += chunk;
            flushStreamUiIfDue();
          }
          const fr = getQwenStreamFinishReason(data);
          if (fr) finishReason = fr;
        } catch {
          /* 忽略单行解析失败 */
        }
      };

      while (true) {
        const { done, value } = await readStreamChunkWithIdle(
          reader,
          qwenStreamIdleMs,
          () =>
            new Error(
              formatQwenFailure(
                `**问题：** 流式输出超过 ${qwenStreamIdleMs / 1000} 秒无新内容，连接已中断。`
              )
            )
        );
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) consumeQwenSseLine(line);
        // 关键：每批处理完让出主线程到绘制步骤，防止微任务自旋导致"最后一起刷新"
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (buffer.trim()) consumeQwenSseLine(buffer);

      if (!fullContent.trim()) {
        logQwenDebug('send_empty_content', {
          chatId: currentChatId,
          status: response.status,
          finishReason,
        });
        throw new Error(
          formatQwenFailure(
            '**问题：** 流式接口未返回有效正文。\n可执行 localStorage.setItem(\'flowgen:debugChatQwen\',\'1\') 后重试以查看详细 debug。'
          )
        );
      }

      logQwenDebug('send_success', {
        chatId: currentChatId,
        elapsedMs: Date.now() - modelStartedAt,
        httpStatus: response.status,
        contentLen: fullContent.length,
        contentPreview: fullContent.slice(0, 200),
        finishReason,
        stream: true,
      });

      let responseText = fullContent;
      if (finishReason === 'length') {
        logQwenDebug('send_truncated_by_max_tokens', {
          chatId: currentChatId,
          maxTokens: qwenMaxTokens,
          contentLen: responseText.length,
        });
        responseText += `\n\n⚠️ **输出已达 max_tokens 上限（${qwenMaxTokens}）被截断。** 若分镜不完整，请缩小单次剧本或分批发送。`;
      }

      const finalized = finalizeAssistantMessageContent(responseText);
      const persistChatId =
        activeSessionChatIdRef.current || chatIdRef.current || currentChatId;

      // 停止逐字动画，由下方 setMessages 闪现完整内容
      cleanupReveal();
      setMessages((prev) => {
        const next = prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: finalized.content,
                tableRows: finalized.tableRows,
                isStreaming: false,
              }
            : msg
        );
        void upsertServerHistory(persistChatId, 'qwen', next);
        return next;
      });
    } catch (error) {
      logQwenDebug('send_failed', {
        chatId: currentChatId,
        retryCount,
        elapsedMs: Date.now() - modelStartedAt,
        requestUrl: qwenApiUrl,
        partialChars: fullContent.trim().length,
        ...(axios.isAxiosError(error) ? extractQwenAxiosErrorDiag(error) : {}),
      });
      if (retryCount < 1 && isLikelyTransientNetworkError(error)) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
        logQwenDebug('retry_once', { chatId: currentChatId, reason: 'transient_network' });
        await handleQwenSend(currentInput, currentImages, forcedChatId, retryCount + 1, sendOpts);
        return;
      }
      const partialChars = preserveIncompleteStreamOnError({
        modelLabel: 'Qwen',
        modelSlug: 'qwen',
        fullContent,
        fullReasoning: '',
        collectReasoning: false,
        userQuestion: userText,
        assistantMessageId,
        setMessages,
        error,
      });
      lastFailedStreamCharsRef.current = Math.max(
        lastFailedStreamCharsRef.current,
        partialChars
      );
      const detail =
        error instanceof Error
          ? error.message.includes('**❌') || error.message.includes('**原因：**')
            ? error.message
            : formatQwenFailure(error.message)
          : formatQwenFailure(String(error));
      throw new Error(detail);
    } finally {
      if (degradedAfterSwitch) endDegradedModelSwitch();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

                // ??????
  const handleModelSelect = (modelId: string) => {
    const fromModel = selectedModel;
    const toModel = modelId;

    if (fromModel !== toModel) {
      // 未点「新对话」时保持同一会话 id，切换模型不新建侧边栏历史
      const sessionChatId = ensureConversationSessionId();
      const normalizedTarget = normalizeModelId(toModel);
      const hadThinkingOrWeb = thinkingMode !== 'off' || useWebSearch;
      // ???? Qwen ??????Gemini/Claude ???????????????
      if (normalizedTarget === 'qwen' && hadThinkingOrWeb) {
        beginDegradedUiForModelSwitch(hadThinkingOrWeb);
      }

      const switchHint =
        normalizedTarget === 'qwen'
          ? hadThinkingOrWeb
            ? '💡 Qwen 暂不支持联网搜索与深度思考，已关闭相关选项。'
            : '💡 当前对话历史已保留，可以继续对话。'
          : hadThinkingOrWeb
            ? '💡 已切换模型，联网搜索/思考模式设置已保留。'
            : '💡 当前对话历史已保留，可以继续对话。';

      const switchMessage: ChatMessage = {
        id: `model-switch-${Date.now()}`,
        role: 'assistant',
        content: `🔄 已切换模型：${modelLabelById(fromModel)} → ${modelLabelById(toModel)}\n\n${switchHint}`,
        timestamp: new Date()
      };

      const nextMessages = [...messages, switchMessage];
      setMessages(nextMessages);
      persistSnapshotRef.current = {
        messages: nextMessages,
        chatId: sessionChatId,
        modelId: normalizedTarget,
      };

      if (normalizedTarget === 'qwen') {
        upsertServerHistory(sessionChatId, 'qwen', nextMessages);
      }
    }

    setSelectedModel(toModel);
    setShowModelSelector(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setAttachedImages(prev => [...prev, ...imageUrls]);
                // ??????
      if (!referencedImage && imageUrls.length > 0) {
        setReferencedImage(imageUrls[0]);
      }
    }
    // ?? input???????????
    if (e.target) {
      e.target.value = '';
    }
  };

                // ??????
  const removeAttachedImage = (indexToRemove: number) => {
    if (indexToRemove >= 0 && indexToRemove < attachedImages.length) {
      const urlToRemove = attachedImages[indexToRemove];
      if (urlToRemove.startsWith('blob:')) {
        URL.revokeObjectURL(urlToRemove);
      }
      const newImages = attachedImages.filter((_, index) => index !== indexToRemove);
      setAttachedImages(newImages);
      if (referencedImage === urlToRemove) {
        setReferencedImage(newImages.length > 0 ? newImages[0] : null);
      }
    }
  };

  const removeAllAttachedImages = () => {
    attachedImages.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
      setAttachedImages([]);
    setReferencedImage(null);
    setReferencedImages([]);
  };

  const handlePanelCopyCapture = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.isContentEditable ||
      target.closest('textarea') ||
      target.closest('input')
    ) {
      return;
    }
    const selected = window.getSelection()?.toString() || '';
    const text = selected.trim();
    if (!text) return;
    if (e.clipboardData) {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const baseEl = node instanceof Element ? node : node.parentElement;
        const tableEl = baseEl?.closest('table');
        if (tableEl) {
          // Word/WPS ? class ???????????????????????????????????
          const clonedTable = tableEl.cloneNode(true) as HTMLTableElement;
          clonedTable.setAttribute(
            'style',
            'border-collapse:collapse;border:1px solid #666;font-size:12px;line-height:1.4;'
          );
          clonedTable.querySelectorAll('th,td').forEach((cell) => {
            (cell as HTMLElement).setAttribute(
              'style',
              'border:1px solid #666;padding:4px 6px;vertical-align:top;white-space:pre-wrap;'
            );
          });
          e.clipboardData.setData('text/html', clonedTable.outerHTML);
        } else {
          const frag = range.cloneContents();
          const wrap = document.createElement('div');
          wrap.appendChild(frag);
          const html = wrap.innerHTML;
          if (html && html.trim()) {
            e.clipboardData.setData('text/html', html);
          }
        }
      }
      e.clipboardData.setData('text/plain', text);
    }
  }, []);

                // ??????
  const clearReferencedImage = () => {
    // ??????????????
    setReferencedImage(null);
    setReferencedImages([]);
  };

  const handleSendSelectedTextToNodes = () => {
    if (!selectedText || selectedNodes.length === 0) {
      setContextMenu(null);
      return;
    }

    updateSelectedNodesData((node) =>
      buildNodePromptUpdatePatch(node.data as NodeData, selectedText)
    );

                // ??????
    window.getSelection()?.removeAllRanges();
    setSelectedText('');
    setContextMenu(null);
  };

  const handleSendSelectedTextToNegativePrompt = () => {
    if (!selectedText || selectedNodes.length === 0) {
      setContextMenu(null);
      return;
    }
    updateSelectedNodesData((node) => buildNegativePromptPatchForChatNode(node, selectedText));
    window.getSelection()?.removeAllRanges();
    setSelectedText('');
    setContextMenu(null);
  };

  const exportSelectionFileBase = () =>
    `flowgen-chat-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

  const resolveContextExportRows = (): string[][] | null => {
    if (contextTableRows && contextTableRows.length > 0) return contextTableRows;
    const t = selectedText.trim();
    if (!t) return null;
    return parseSelectionToRows(t);
  };

  const clearContextMenuSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectedText('');
    setContextTableRows(null);
    setContextMenu(null);
  };

  const handleExportSelectionCsv = () => {
    const rows = resolveContextExportRows();
    if (!rows) {
      setContextMenu(null);
      return;
    }
    try {
      exportRowsAsCsv(rows, exportSelectionFileBase());
    } catch (e) {
    }
    clearContextMenuSelection();
  };

  const handleExportSelectionXlsx = async () => {
    const rows = resolveContextExportRows();
    if (!rows) {
      setContextMenu(null);
      return;
    }
    try {
      await exportRowsAsXlsx(rows, exportSelectionFileBase());
    } catch (e) {
      alert('xlsx 导出失败，是否尝试 CSV？');
    }
    clearContextMenuSelection();
  };

  /** 导出右键消息为 Word 文档 */
  const handleExportMessageAsWord = async () => {
    const msgId = contextMessageId;
    if (!msgId) {
      setContextMenu(null);
      return;
    }
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) {
      setContextMenu(null);
      return;
    }
    try {
      const content = msg.content || '';
      // 解析 markdown 段落
      const lines = content.split('\n');
      const paragraphs: Paragraph[] = [];
      let inCodeBlock = false;
      let codeLines: string[] = [];
      let codeLang = '';
      let inTable = false;
      let tableRows: string[][] = [];

      const flushTable = () => {
        if (tableRows.length === 0) return;
        const maxCols = Math.max(...tableRows.map((r) => r.length));
        const border = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows.map((row, ri) =>
            new TableRow({
              children: Array.from({ length: maxCols }, (_, ci) => {
                const text = row[ci] || '';
                const isHeader = ri === 0;
                return new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text, bold: isHeader })] })],
                  borders,
                  shading: isHeader ? { fill: 'F0F0F0' } : undefined,
                });
              }),
            })
          ),
        });
        paragraphs.push(new Paragraph({ children: [] }));
        (paragraphs as any).push(table);
        tableRows = [];
        inTable = false;
      };

      const flushCode = () => {
        if (codeLines.length === 0) return;
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: codeLines.join('\n'), font: 'Consolas', size: 20 })],
            shading: { fill: 'F5F5F5' },
            spacing: { before: 100, after: 100 },
          })
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      };

      for (const line of lines) {
        // 代码块
        if (line.startsWith('```')) {
          if (inCodeBlock) {
            flushCode();
          } else {
            inCodeBlock = true;
            codeLang = line.slice(3).trim();
          }
          continue;
        }
        if (inCodeBlock) {
          codeLines.push(line);
          continue;
        }

        // 表格行（| col | col |）
        if (/^\|.*\|$/.test(line.trim())) {
          // 跳过分隔行 |---|---|
          if (/^\|[\s\-:]+\|$/.test(line.trim())) continue;
          const cells = line.split('|').slice(1, -1).map((c) => c.trim());
          tableRows.push(cells);
          inTable = true;
          continue;
        }
        if (inTable) {
          flushTable();
        }

        // 标题
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingLevels = [
            HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
          ];
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: headingMatch[2], bold: true, size: 28 - level * 2 })],
              heading: headingLevels[level - 1],
              spacing: { before: 200, after: 100 },
            })
          );
          continue;
        }

        // 无序列表
        if (/^[\-\*]\s+/.test(line)) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line.replace(/^[\-\*]\s+/, '• '), size: 22 })],
              spacing: { before: 40, after: 40 },
            })
          );
          continue;
        }

        // 有序列表
        const olMatch = line.match(/^(\d+)[\.\)]\s+(.+)$/);
        if (olMatch) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: `${olMatch[1]}. ${olMatch[2]}`, size: 22 })],
              spacing: { before: 40, after: 40 },
            })
          );
          continue;
        }

        // 引用
        if (line.startsWith('> ')) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line.slice(2), italics: true, color: '666666', size: 22 })],
              indent: { left: 400 },
              spacing: { before: 40, after: 40 },
            })
          );
          continue;
        }

        // 空行
        if (line.trim() === '') {
          paragraphs.push(new Paragraph({ children: [] }));
          continue;
        }

        // 普通文本：处理 **bold** 和 *italic*
        const parts: TextRun[] = [];
        let remaining = line;
        while (remaining.length > 0) {
          const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
          const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
          let firstMatch: { index: number; length: number; text: string; bold: boolean; italic: boolean } | null = null;
          if (boldMatch && boldMatch.index !== undefined) {
            firstMatch = { index: boldMatch.index, length: boldMatch[0].length, text: boldMatch[1], bold: true, italic: false };
          }
          if (italicMatch && italicMatch.index !== undefined) {
            if (!firstMatch || italicMatch.index < firstMatch.index) {
              firstMatch = { index: italicMatch.index, length: italicMatch[0].length, text: italicMatch[1], bold: false, italic: true };
            }
          }
          if (!firstMatch) {
            parts.push(new TextRun({ text: remaining, size: 22 }));
            break;
          }
          if (firstMatch.index > 0) {
            parts.push(new TextRun({ text: remaining.slice(0, firstMatch.index), size: 22 }));
          }
          parts.push(new TextRun({ text: firstMatch.text, bold: firstMatch.bold, italics: firstMatch.italic, size: 22 }));
          remaining = remaining.slice(firstMatch.index + firstMatch.length);
        }
        paragraphs.push(
          new Paragraph({ children: parts, spacing: { before: 40, after: 40 } })
        );
      }
      if (inCodeBlock) flushCode();
      if (inTable) flushTable();

      // 追加结构化表格数据（content 中可能不含 markdown 表格文本）
      if (msg.tableRows && msg.tableRows.length > 0) {
        const maxCols = Math.max(...msg.tableRows.map((r) => r.length));
        const border = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: msg.tableRows.map((row, ri) =>
            new TableRow({
              children: Array.from({ length: maxCols }, (_, ci) => {
                const text = row[ci] || '';
                const isHeader = ri === 0;
                return new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text, bold: isHeader })] })],
                  borders,
                  shading: isHeader ? { fill: 'F0F0F0' } : undefined,
                });
              }),
            })
          ),
        });
        paragraphs.push(new Paragraph({ children: [] }));
        (paragraphs as any).push(table);
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              children: [new TextRun({ text: `${msg.role === 'assistant' ? 'AI 回复' : '用户消息'} - ${new Date(msg.timestamp).toLocaleString('zh-CN')}`, bold: true, size: 20, color: '888888' })],
              alignment: AlignmentType.RIGHT,
              spacing: { after: 200 },
            }),
            ...paragraphs,
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportSelectionFileBase()}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出 Word 文档失败');
    }
    setContextMenu(null);
    setContextMessageId(null);
  };

  /** ???????????????????????????????????? */
  const handleInsertTablePreviewInChat = () => {
    const rows = resolveContextExportRows();
    if (!rows) {
      setContextMenu(null);
      return;
    }
    const matrix = padRowsToMatrix(rows);
    setMessages((prev) => [
      ...prev,
      {
        id: 'table-preview-' + Date.now(),
        role: 'assistant',
        content: '已生成表格预览，可导出为 CSV / xlsx',
        tableRows: matrix,
        timestamp: new Date(),
      },
    ]);
    clearContextMenuSelection();
  };

  const handleSpawnStoryboardNodesFromTable = () => {
    const rows = contextTableRows;
    const liveSelected = getCanvasSelectedNodes?.() ?? selectedNodes;
    const liveSelectedNode =
      liveSelected.length === 1
        ? liveSelected[0]
        : liveSelected.length === 0
          ? selectedNode
          : null;
    const projectIdFromHash =
      typeof window !== 'undefined'
        ? window.location.hash.match(/#\/workspace\/([^/?#]+)/i)?.[1]
        : undefined;
    const projectId =
      workspaceProjectId || chatStorageScope.projectId || projectIdFromHash || undefined;
    const validation = validateStoryboardTableSpawn(
      rows,
      liveSelected,
      liveSelectedNode,
      getLiveTemplateData,
      projectId,
      getCanvasNodes?.()
    );
    if (validation.ok === false) {
      alert(validation.error);
      setContextMenu(null);
      return;
    }
    if (!onSpawnStoryboardNodesFromTable) {
      setContextMenu(null);
      return;
    }
    const result = onSpawnStoryboardNodesFromTable({
      rows: rows!,
      templateNodeId: validation.templateNode.id,
    });
    if (result.ok === false) {
      alert(result.error);
    } else {
      alert(`已生成 ${result.created} 个下游节点`);
    }
    clearContextMenuSelection();
  };

  const handleReferenceNode = () => {
    const nodesToReference = selectedNodes.length > 0 ? selectedNodes : (selectedNode ? [selectedNode] : []);
    
    if (nodesToReference.length === 0) return;

    // ??????????
    const allNodeImages: string[] = [];
    const nodeInfos: string[] = [];
    
    nodesToReference.forEach((node, index) => {
      const displayLabel =
        node.data.customName?.trim() || node.data.label?.trim() || node.data.imageName?.trim() || '未命名节点';
      const nodeInfo =
        `📌 节点 ${index + 1}：${displayLabel}\n` +
        `- 节点类型：${getNodeTypeName(node.type)}\n` +
        (node.data.prompt ? `- 提示词：${node.data.prompt}\n` : '') +
        (node.data.selectedModel ? `- 使用模型：${node.data.selectedModel}\n` : '') +
        (resolveNodeSelectionPreviewUrl(node.data, projectAssetLabelRows)
          ? `- 包含图片预览`
          : '');
      nodeInfos.push(nodeInfo);

      const previewUrl = resolveNodeSelectionPreviewUrl(node.data, projectAssetLabelRows);
      if (previewUrl) {
        allNodeImages.push(previewUrl);
      }
    });

    const referenceMessage: ChatMessage = {
      id: 'reference-' + Date.now(),
      role: 'user',
      content: `📌 引用 ${nodesToReference.length} 个节点信息：\n\n${nodeInfos.join('\n\n')}`,
      imageUrl: allNodeImages.length > 0 ? allNodeImages[0] : undefined,
      imageUrls: allNodeImages.length > 0 ? allNodeImages : undefined,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, referenceMessage]);
    
                // ??????
    if (allNodeImages.length > 0) {
      // ???????????? referencedImage????? referencedImages?
      setReferencedImage(allNodeImages[0]);
                // ??????
      setReferencedImages([...allNodeImages]);
    }
    
    // ??????????????????????????"????"??
    setShowNodePreview(false);
    
    // ????AI????
    setTimeout(() => {
      const nodeNames = nodesToReference
        .map((n) => `"${n.data.customName?.trim() || n.data.label || '未命名'}"`)
        .join('、');
      const confirmMessage: ChatMessage = {
        id: 'confirm-' + Date.now(),
        role: 'assistant',
        content: `✅ 已引用 ${nodesToReference.length} 个节点（${nodeNames}）的信息。我可以帮您分析这些节点的内容，请告诉我您想了解什么？`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, confirmMessage]);
    }, 300);
  };

  const imageUrlToBase64 = async (imageUrl: string): Promise<string> => {
    try {
      if (imageUrl.startsWith('data:image/')) {
        return imageUrl;
      }

      if (imageUrl.startsWith('blob:')) {
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`);
          }
          const blob = await response.blob();
          
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              if (!result) {
                reject(new Error('FileReader 返回结果为空'));
                return;
              }
              resolve(result);
            };
            reader.onerror = (e) => {
              reject(new Error('FileReader 读取失败'));
            };
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          throw error;
        }
      }

      // ????URL?http/https?????????????CORS??
      
      try {
        const proxyUrl = `/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        
        const response = await fetch(proxyUrl);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`图片代理请求失败: ${response.status} ${response.statusText}`);
        }
        
        // ??Content-Type
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        const blob = await response.blob();
        
        if (blob.size === 0) {
          throw new Error('图片内容为空');
        }
        
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            if (!result) {
              reject(new Error('FileReader 返回结果为空'));
              return;
            }
            
            // ??base64??
            if (!result.startsWith('data:image/')) {
              reject(new Error('Base64 结果不是有效的 data:image/ 格式'));
              return;
            }
            
            resolve(result);
          };
          reader.onerror = (e) => {
              reject(new Error('FileReader 读取失败'));
          };
          reader.readAsDataURL(blob);
        });
      } catch (proxyError) {
        
        try {
          const response = await fetch(imageUrl, {
            mode: 'cors',
            credentials: 'omit'
          });
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`);
          }
          const blob = await response.blob();
          
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              if (!result) {
                reject(new Error('FileReader 返回结果为空'));
                return;
              }
              resolve(result);
            };
            reader.onerror = (e) => {
              reject(new Error('FileReader 读取失败'));
            };
            reader.readAsDataURL(blob);
          });
        } catch (fetchError) {
          
          return new Promise((resolve, reject) => {
            const img = new Image();
            let isResolved = false;
            
            // ??????0??
            const timeoutId = setTimeout(() => {
              if (!isResolved) {
                isResolved = true;
                reject(new Error('图片加载超时（30秒）'));
              }
            }, 30000);
            
            img.onload = () => {
              if (isResolved) return;
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  isResolved = true;
                  clearTimeout(timeoutId);
                  reject(new Error('无法获取 canvas 上下文'));
                  return;
                }
                ctx.drawImage(img, 0, 0);
                const base64 = canvas.toDataURL('image/png');
                isResolved = true;
                clearTimeout(timeoutId);
                resolve(base64);
              } catch (error) {
                if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timeoutId);
                  reject(error);
                }
              }
            };
            
            img.onerror = (error) => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                reject(new Error(`图片加载失败: 无法通过 fetch、canvas 或直连加载 URL: ${imageUrl.substring(0, 100)}`));
              }
            };
            
            img.crossOrigin = 'anonymous';
            img.src = imageUrl;
          });
        }
      }
    } catch (error) {
      throw error;
    }
  };

  const selectedModelData = AI_MODELS.find(m => m.id === selectedModel);

  return (
    <div
      ref={panelRef}
      data-flowgen-chat-panel
      onCopyCapture={handlePanelCopyCapture}
      className="flex-1 flex flex-col bg-[#0a0a0f] overflow-hidden select-text"
    >
        {/* ??? - ??????? */}
      <div className="relative h-[56px] border-b border-gray-800/60 bg-gradient-to-b from-[#111118] to-[#0a0a0f] flex items-center justify-between px-4">
          {/* ????? */}
        <div className="absolute inset-0 bg-gradient-to-r from-brand-500/5 via-transparent to-purple-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500/30 to-transparent"></div>
        
        {/* ??????? */}
        <button
          type="button"
          onClick={() => {
            setHistoryError('');
            setHistoryOpen((v) => !v);
          }}
            title="打开聊天历史"
          className={`flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px] ${
            historyOpen ? 'border-brand-500/45 ring-1 ring-brand-500/35' : 'border-gray-700/60 hover:border-brand-500/40'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-5 flex items-center justify-center text-brand-400 text-base leading-none">
              <MessageSquare size={16} strokeWidth={2.5} />
            </span>
            <span className="text-xs font-medium truncate">聊天历史</span>
          </span>
          {historyOpen ? (
            <ChevronUp size={12} className="text-gray-400 group-hover:text-brand-400 transition-colors" />
          ) : (
            <ChevronDown size={12} className="text-gray-400 group-hover:text-brand-400 transition-colors" />
          )}
        </button>

        {activeProjectSkill && (
          <span
            className="relative z-10 mx-2 flex-shrink min-w-0 max-w-[160px] truncate rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300/95"
            title="本项目已启用 Skill，对话将按项目设定回答"
          >
            已启用 · {activeProjectSkill.title?.trim() || '项目 Skill'}
          </span>
        )}

        {/* ?????????*/}
        <div ref={modelMenuRef} className="relative z-10 flex items-center gap-2">
          <button
            onClick={() => setShowModelSelector(!showModelSelector)}
            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border border-gray-700/60 hover:border-brand-500/40 text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px]"
            title="选择模型"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-5 flex items-center justify-center text-base leading-none">{selectedModelData?.icon}</span>
              <span className="text-xs font-medium truncate">{selectedModelData?.name}</span>
              {/* 模型速度小圆点：Qwen 绿(公司内部部署)，DeepSeek/Doubao 黄(国内api)，Claude/Gemini 红(第三方api) */}
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  selectedModel === 'qwen'
                    ? 'bg-emerald-400'
                    : selectedModel === 'deepseek-v4-pro' || selectedModel === 'doubao-seed-2.0'
                    ? 'bg-amber-400'
                    : 'bg-red-400'
                }`}
                title={
                  selectedModel === 'qwen'
                    ? '稳定，快速：公司内部部署'
                    : selectedModel === 'deepseek-v4-pro' || selectedModel === 'doubao-seed-2.0'
                    ? '较稳定，速度普通：国内api访问'
                    : '不稳定，较慢：第三方api访问'
                }
              />
            </span>
            {showModelSelector ? (
              <ChevronUp size={12} className="text-gray-400 group-hover:text-brand-400 transition-colors" />
            ) : (
              <ChevronDown size={12} className="text-gray-400 group-hover:text-brand-400 transition-colors" />
            )}
          </button>
          
          {showModelSelector && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900/98 backdrop-blur-xl border border-gray-700/60 rounded-2xl shadow-2xl z-50 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
              <div className="p-2">
              {AI_MODELS.filter((m) => m.id !== selectedModel).map((model) => {
                // 模型速度标识：Qwen 绿(公司内部部署)，DeepSeek/Doubao 黄(国内api)，Claude/Gemini 红(第三方api)
                const speedDot =
                  model.id === 'qwen' ? '🟢'
                  : model.id === 'deepseek-v4-pro' || model.id === 'doubao-seed-2.0' ? '🟡'
                  : '🔴';
                const speedTip =
                  model.id === 'qwen' ? '稳定，快速：公司内部部署'
                  : model.id === 'deepseek-v4-pro' || model.id === 'doubao-seed-2.0' ? '较稳定，速度普通：国内api访问'
                  : '不稳定，较慢：第三方api访问';
                const speedLabel =
                  model.id === 'qwen' ? '稳定快速'
                  : model.id === 'deepseek-v4-pro' || model.id === 'doubao-seed-2.0' ? '较稳定'
                  : '不稳定';
                return (
                <button
                  key={model.id}
                  onClick={() => handleModelSelect(model.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 group ${
                      'text-gray-300 hover:bg-gray-800/60 hover:text-white'
                    }`}
                  >
                    <span className="text-base">{model.icon}</span>
                    <span className="flex-1 truncate">{model.name}</span>
                    <span className="text-[10px] text-gray-500 group-hover:text-gray-400 flex items-center gap-1" title={speedTip}>
                      <span>{speedDot}</span>
                      <span className="hidden group-hover:inline">{speedLabel}</span>
                    </span>
                </button>
                );
              })}
              </div>
              <div className="px-3 py-2 border-t border-gray-800/60 text-[10px] text-gray-500 leading-relaxed">
                🟢 稳定，快速：公司内部部署<br/>
                🟡 较稳定，速度普通：国内api访问<br/>
                🔴 不稳定，较慢：第三方api访问
              </div>
            </div>
          )}
        </div>

      </div>

          {/* ????? */}
      {historyOpen && (
        <div className="absolute inset-0 z-[60] pointer-events-none">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px] pointer-events-auto"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[min(560px,100%)] bg-[#0b0b11] border-l border-gray-800/70 shadow-2xl pointer-events-auto flex flex-col">
            <div className="h-[56px] flex items-center justify-between px-4 border-b border-gray-800/60 bg-gradient-to-b from-[#111118] to-[#0b0b11]">
              <div className="text-sm font-semibold text-gray-100">聊天历史</div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white transition-colors"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 border-b border-gray-800/40">
              {historyError && (
                <div className="mt-2 text-[11px] text-red-400 whitespace-pre-wrap">{historyError}</div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2 custom-scrollbar">
              {sortedSessions.length === 0 ? (
                <div className="text-xs text-gray-500 p-2">暂无历史。先发送一次消息即可生成并保存会话。</div>
              ) : (
                sortedSessions.map((s) => {
                  const modelName = AI_MODELS.find((m) => m.id === s.modelId)?.name || s.modelId;
                  const isActive = s.chatId === chatId;
                  return (
                    <div
                      key={s.chatId}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (historyLoading) return;
                        void openSessionAndLoad(s.chatId, s.modelId);
                      }}
                      onKeyDown={(e) => {
                        if (historyLoading) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openSessionAndLoad(s.chatId, s.modelId);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSessionExportMenu({ x: e.clientX, y: e.clientY, session: s });
                      }}
                      data-history-session-item="1"
                      className={`w-full text-left p-3 rounded-xl border transition-colors relative group cursor-pointer ${
                        isActive
                          ? 'border-brand-500/60 bg-brand-500/10'
                          : 'border-gray-800 bg-gray-950/30 hover:bg-gray-800/30'
                      } ${historyLoading ? 'opacity-60 pointer-events-none' : ''}`}
                      title="加载该会话历史并继续聊天（右键可导出备份）"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void deleteSession(s.chatId);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg text-gray-500 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="删除该会话"
                        aria-label="删除该会话"
                      >
                        <X size={14} />
                      </button>
                      <div className="text-[11px] font-semibold text-gray-100 truncate pr-8">
                        {s.title && s.title.trim() ? s.title : '未命名会话'}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400 truncate">{modelName}</div>
                      <div className="mt-1 text-[10px] text-gray-500">
                        {new Date(normalizeSessionUpdatedAt(s.updatedAt)).toLocaleString()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

        {/* ??? - ??????? */}
      {(selectedNode || selectedNodes.length > 0) && (
        <div className="px-5 py-3 border-b border-gray-800/40 bg-gradient-to-b from-[#0f0f15] to-transparent">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse shadow-lg shadow-brand-400/50"></div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                当前选中节点{selectedNodes.length > 0 ? ` (${selectedNodes.length})` : ''}
              </span>
            </div>
            <button
              onClick={handleReferenceNode}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-brand-600/20 to-purple-600/20 hover:from-brand-600/30 hover:to-purple-600/30 border border-brand-500/30 hover:border-brand-500/50 text-brand-400 hover:text-brand-300 text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 shadow-lg hover:shadow-brand-500/20 backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={selectedNodes.length > 0 ? `引用 ${selectedNodes.length} 个节点信息到对话` : "引用节点信息到对话"}
              disabled={!selectedNode && selectedNodes.length === 0}
            >
              <Link2 size={12} strokeWidth={2.5} />
              <span>引用节点{selectedNodes.length > 0 ? ` (${selectedNodes.length})` : ''}</span>
            </button>
          </div>
          
        {/* ??? - ??????? */}
          {showNodePreview && (
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-500/10 to-purple-500/10 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative bg-gradient-to-br from-gray-800/70 to-gray-900/70 p-4 rounded-2xl border border-gray-700/50 shadow-xl backdrop-blur-sm">
              {(() => {
                const nodesToDisplay = selectedNodes.length > 0 ? selectedNodes : (selectedNode ? [selectedNode] : []);
                if (nodesToDisplay.length === 0) return null;
                
                // ??????
                const previewImages = nodesToDisplay
                  .map((node) => {
                    const imageUrl = resolveNodeSelectionPreviewUrl(
                      node.data,
                      projectAssetLabelRows
                    );
                    return {
                      node,
                      imageUrl,
                      isVideo: imageUrl
                        ? /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(imageUrl) ||
                          imageUrl.includes('video') ||
                          node.type === NodeType.MOV
                        : false,
                    };
                  })
                  .filter((item) => item.imageUrl);
                return (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-semibold text-white text-sm leading-tight">
                        {nodesToDisplay.length > 1 ? (
                          <span>已选择 {nodesToDisplay.length} 个节点</span>
                        ) : (
                          nodesToDisplay[0].data.label
                        )}
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-brand-500/15 border border-brand-500/30 backdrop-blur-sm">
                        <span className="text-[10px] text-brand-400 font-bold uppercase tracking-wide">
                          {nodesToDisplay.length > 1 ? `${nodesToDisplay.length} 个节点` : getNodeTypeName(nodesToDisplay[0].type)}
                        </span>
                      </div>
                    </div>
                    {previewImages.length > 0 && (
                      <div className={`grid gap-2 ${
                        previewImages.length === 1 ? 'grid-cols-1' :
                        previewImages.length === 2 ? 'grid-cols-2' :
                        previewImages.length === 3 ? 'grid-cols-3' :
                        previewImages.length === 4 ? 'grid-cols-2 grid-rows-2' :
                        'grid-cols-3'
                      }`}>
                        {previewImages.map((item, index) => (
                          <div key={index} className="rounded-xl overflow-hidden border border-gray-700/50 shadow-lg ring-1 ring-black/30">
                            {item.isVideo ? (
                              <video
                                src={resolveDisplayMediaUrl(item.imageUrl!)}
                                className="w-full h-24 object-cover"
                                controls
                                muted
                                playsInline
                              />
                            ) : (
                              <img
                                src={resolveDisplayMediaUrl(item.imageUrl!)}
                                alt={`附加图片 ${index + 1}`}
                                className="w-full h-24 object-cover"
                              />
                            )}
                          </div>
                        ))}
              </div>
            )}
                    {nodesToDisplay.length > 1 && previewImages.length > 0 && (
                      <div className="mt-2 text-xs text-gray-400 text-center">
                        共 {previewImages.length} 张预览图，共 {nodesToDisplay.length} 个节点
                      </div>
                    )}
                  </>
                );
              })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ???? - ??????*/}
      <div 
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-scroll px-5 py-6 space-y-6 bg-[#0a0a0f] custom-scrollbar relative select-text"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="relative mb-8">
              <div className="absolute -inset-4 bg-gradient-to-br from-brand-500/20 to-purple-500/20 rounded-3xl blur-2xl"></div>
              <div className="relative p-8 bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-3xl border border-gray-700/50 backdrop-blur-sm">
                <Bot size={64} className="text-brand-400/50" strokeWidth={1.5} />
              </div>
            </div>
            <div className="text-sm font-semibold text-gray-400 mb-1.5">开始与AI对话...</div>
            <div className="text-xs text-gray-600 font-medium">在下方输入消息，支持联网搜索与深度思考</div>
          </div>
        ) : (
          <>
            {hasHiddenMessages && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadOlderMessages}
                  className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 bg-gray-900/60 hover:bg-gray-800/70 text-gray-300"
                  title="显示更早的消息（历史内容不丢失）"
                >
                  显示更早消息 ({firstVisibleMessageIndex})
                </button>
              </div>
            )}
            {visibleMessages.map((message, index) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                index={firstVisibleMessageIndex + index}
              />
            ))}
            
            {/* 流式指示器：仅在已收到流式 assistant 消息时不显示，避免与实时输出内容重复 */}
            {(() => {
              const lastMsg = visibleMessages[visibleMessages.length - 1];
              const hasStreamingAssistant =
                isLoading &&
                lastMsg?.role === 'assistant' &&
                (lastMsg as ChatMessage).isStreaming;
              if (hasStreamingAssistant) return null;
              return isLoading ? (
                <div className="flex items-end justify-start gap-3 animate-[slideIn_0.3s_ease-out]">
                  <div className="relative flex-shrink-0">
                    <div className="absolute -inset-1 bg-gradient-to-br from-brand-500/40 to-purple-500/40 rounded-full blur-md animate-pulse"></div>
                    <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-brand-500/40 flex items-center justify-center shadow-xl">
                      <Bot size={20} className="text-brand-400" strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 text-gray-200 rounded-2xl p-4 shadow-2xl border border-gray-700/60 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                      <Loader2 size={18} className="animate-spin text-brand-400" strokeWidth={2.5} />
                      <span className="text-sm font-medium">正在生成回复...</span>
                    </div>
                  </div>
                </div>
              ) : null;
            })()}
        <div ref={messagesEndRef} />
          </>
        )}

          {/* ????? */}
        {contextMenu && (
          <div
            className="context-menu fixed z-50 animate-[fadeIn_0.2s_ease-out]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gray-900/98 backdrop-blur-xl border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden min-w-[200px]">
              <button
                onClick={() => handleSendPresetToModel('核心版分镜技能', DIRECTOR_STORYBOARD_CORE_MD)}
                className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-brand-600/20 hover:to-purple-600/20 transition-all duration-200 flex items-center gap-2"
                title="发送 director-storyboard-core.md 内容到当前模型"
              >
                <Zap size={16} strokeWidth={2.5} className="text-brand-400" />
                <span>发送分镜核心版</span>
              </button>
              <button
                onClick={() => handleSendPresetToModel('进阶版分镜技能', DIRECTOR_STORYBOARD_ADVANCED_MD)}
                className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-brand-600/20 hover:to-purple-600/20 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60"
                title="发送 director-storyboard-advanced.md 内容到当前模型"
              >
                <Sparkles size={16} strokeWidth={2.5} className="text-purple-400" />
                <span>发送分镜进阶版</span>
              </button>
              {contextMessageId && (
                <button
                  type="button"
                  onClick={() => void handleExportMessageAsWord()}
                  className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-amber-900/40 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60"
                  title="将当前消息导出为 .docx Word 文档（支持 Word / WPS 打开编辑）"
                >
                  <FileText size={16} strokeWidth={2.5} className="text-amber-400" />
                  <span>导出为 Word 文档</span>
                </button>
              )}
              {(selectedText.trim().length > 0 || (contextTableRows && contextTableRows.length > 0)) && (
                <>
                  <button
                    type="button"
                    onClick={handleExportSelectionCsv}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-emerald-900/40 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60"
                    title="下载 .csv 文件：用 Excel 打开时选择「数据 → 自文本/CSV」或直接双击用 Excel 打开（UTF-8）"
                  >
                    <FileSpreadsheet size={16} strokeWidth={2.5} className="text-emerald-400" />
                    <span>导出为 CSV（Excel 可用）</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportSelectionXlsx()}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-emerald-900/40 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60"
                    title="下载标准 .xlsx 文件，直接用 Microsoft Excel / WPS 双击打开即可"
                  >
                    <FileSpreadsheet size={16} strokeWidth={2.5} className="text-green-400" />
                    <span>导出为 Excel（.xlsx）</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertTablePreviewInChat}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-sky-900/35 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60"
                    title="在下方对话中插入一条带表格的消息（不调用模型）"
                  >
                    <Table2 size={16} strokeWidth={2.5} className="text-sky-400" />
                    <span>在对话中显示为表格</span>
                  </button>
                  {onSpawnStoryboardNodesFromTable && (
                    <button
                      type="button"
                      onClick={handleSpawnStoryboardNodesFromTable}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-lime-900/35 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 border-t border-gray-700/60 border-l-[3px] border-l-lime-400/60"
                      title="以画布上选中的 1 个节点为模板，按表格每行克隆下游节点并连线"
                    >
                      <GitBranch size={16} strokeWidth={2.5} className="text-lime-400" />
                      <span>按分镜表生成下游节点</span>
                    </button>
                  )}
                </>
              )}
              {selectedNodes.length > 0 ? (
                <>
                  <button
                    onClick={handleSendSelectedTextToNodes}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-brand-600/20 hover:to-purple-600/20 transition-all duration-200 flex items-center gap-2 group border-t border-gray-700/60"
                    title={`发送到 ${selectedNodes.length} 个节点的创意描述`}
                  >
                    <ArrowRight size={16} strokeWidth={2.5} className="text-brand-400 group-hover:text-brand-300" />
                    <span>发送到创意描述</span>
                    <span className="ml-auto text-xs text-gray-400 group-hover:text-gray-300">({selectedNodes.length})</span>
                  </button>
                  <button
                    onClick={handleSendSelectedTextToNegativePrompt}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-red-900/30 hover:to-gray-800 transition-all duration-200 flex items-center gap-2 group border-t border-gray-700/60"
                    title={`发送到 ${selectedNodes.length} 个节点的不希望呈现内容`}
                  >
                    <Ban size={16} strokeWidth={2.5} className="text-red-400/90 group-hover:text-red-300" />
                    <span>发送到节点不希望呈现内容</span>
                    <span className="ml-auto text-xs text-gray-400 group-hover:text-gray-300">({selectedNodes.length})</span>
                  </button>
                </>
              ) : selectedText.trim().length === 0 && !(contextTableRows && contextTableRows.length > 0) ? (
                <div className="px-4 py-3 text-sm font-medium text-gray-400 flex items-center gap-2 border-t border-gray-700/60">
                  <span>点击或框选表格任意位置可导出 CSV / Excel 或按分镜表生成下游节点（需先选中 1 个模板节点）；框选文本可 Ctrl+C 复制</span>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {sessionExportMenu && (
          <div
            className="history-session-menu fixed z-[70] animate-[fadeIn_0.15s_ease-out]"
            style={{ left: `${sessionExportMenu.x}px`, top: `${sessionExportMenu.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gray-900/98 backdrop-blur-xl border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden min-w-[220px]">
              <button
                type="button"
                onClick={() => void exportSessionBackup(sessionExportMenu.session)}
                className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-emerald-900/35 hover:to-gray-800 transition-all duration-200"
                title="导出轻量结构化备份（包含可粘贴恢复文本）"
              >
                导出对话备份（JSON）
              </button>
              <button
                type="button"
                onClick={() => void copySessionRestoreText(sessionExportMenu.session)}
                className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-brand-900/35 hover:to-gray-800 transition-all duration-200 border-t border-gray-700/60"
                title="复制可直接粘贴到新对话的恢复文本"
              >
                复制恢复文本
              </button>
            </div>
          </div>
        )}
      </div>

        {/* ??? - ??????? */}
      <div 
        className="px-4 py-3 border-t border-gray-800/40 bg-gray-900/50 backdrop-blur-sm"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files);
          const imageFiles = files.filter(file => file.type.startsWith('image/'));
          if (imageFiles.length > 0) {
            const imageUrls = imageFiles.map(file => URL.createObjectURL(file));
            setAttachedImages(prev => [...prev, ...imageUrls]);
                // ??????
            if (!referencedImage && imageUrls.length > 0) {
              setReferencedImage(imageUrls[0]);
            }
          }
        }}
      >
        {/* ??? - ??????? */}
        {referencedImage && (
          <div className="mb-3 p-3 bg-gradient-to-br from-brand-500/10 to-purple-500/10 rounded-xl border border-brand-500/30 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-medium text-brand-300">
              <ImageIcon size={14} className="text-brand-400" />
              <span className="flex-1">正在引用图片进行对话</span>
              <button
                onClick={clearReferencedImage}
                className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 text-xs font-semibold transition-all duration-200 flex items-center gap-1.5"
                title="中止引用图片对话"
              >
                <X size={12} strokeWidth={2.5} />
                <span>中止引用</span>
              </button>
            </div>
          </div>
        )}

        {/* ????????????????*/}
        {attachedImages.length > 0 && (
          <div className="mb-3 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-300 mb-2">
              <ImageIcon size={12} className="text-gray-400" />
              <span>附加图片 ({attachedImages.length})</span>
              <button
                onClick={removeAllAttachedImages}
                className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-red-500/20 transition-all"
                title="移除所有图片"
              >
                <X size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {attachedImages.map((imageUrl, index) => (
                <div key={index} className="relative group rounded-lg overflow-hidden border border-gray-700/50">
                  <img
                    src={resolveDisplayMediaUrl(imageUrl)}
                    alt={`附加图片 ${index + 1}`}
                    className="w-full h-24 object-cover"
                  />
                  <button
                    onClick={() => removeAttachedImage(index)}
                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="移除这张图片"
                  >
                    <X size={10} />
                  </button>
                  {referencedImage === imageUrl && (
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-brand-500/80 text-white text-[8px] font-semibold rounded">
                      引用中
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ????- ????????*/}
          <div className="flex flex-col gap-2">
          {/* ?????/ ?????? */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => resetConversation()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700/70 bg-gray-900/70 hover:bg-gray-800/80 text-gray-200 whitespace-nowrap transition-colors flex items-center gap-2"
              title="新对话"
              disabled={isLoading}
            >
              <MessageSquare size={14} className="text-gray-400" strokeWidth={2} />
              <span>新对话</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseWebSearch(!useWebSearch)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                  isQwenChatUiModel(selectedModel)
                    ? 'bg-gray-800/40 text-gray-500 cursor-not-allowed border border-gray-700/30'
                    : useWebSearch
                    ? 'bg-gradient-to-r from-cyan-600/30 to-sky-600/30 text-cyan-200 border border-cyan-500/50 shadow-lg shadow-cyan-500/20'
                      : 'bg-gray-800/60 text-gray-400 hover:text-gray-300 border border-gray-700/50 hover:border-gray-600/50'
                }`}
                title={isQwenChatUiModel(selectedModel) ? 'Qwen 暂不支持联网搜索' : '是否允许模型联网检索（AiTop 模型生效）'}
                disabled={isQwenChatUiModel(selectedModel)}
              >
                <Link2 size={14} className={useWebSearch && !isQwenChatUiModel(selectedModel) ? 'text-cyan-300' : 'text-gray-500'} strokeWidth={2} />
                <span>联网搜索</span>
                {useWebSearch && !isQwenChatUiModel(selectedModel) && (
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse"></div>
                )}
              </button>
              <button
                onClick={() =>
                  setThinkingMode((prev) =>
                    prev === 'off' ? 'light' : prev === 'light' ? 'deep' : 'off'
                  )
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                  isQwenChatUiModel(selectedModel)
                    ? 'bg-gray-800/40 text-gray-500 cursor-not-allowed border border-gray-700/30'
                    : thinkingMode === 'deep'
                    ? 'bg-gradient-to-r from-purple-600/30 to-blue-600/30 text-purple-300 border border-purple-500/50 shadow-lg shadow-purple-500/20'
                      : thinkingMode === 'light'
                        ? 'bg-gradient-to-r from-indigo-600/30 to-slate-600/30 text-indigo-200 border border-indigo-500/50 shadow-lg shadow-indigo-500/20'
                        : 'bg-gray-800/60 text-gray-400 hover:text-gray-300 border border-gray-700/50 hover:border-gray-600/50'
                }`}
                title={
                  isQwenChatUiModel(selectedModel)
                    ? 'Qwen 暂不支持深度思考'
                    : '思考：关 → 浅 → 深（循环切换）'
                }
                disabled={isQwenChatUiModel(selectedModel)}
              >
                <Brain
                  size={14}
                  className={
                    !isQwenChatUiModel(selectedModel) && thinkingMode !== 'off'
                      ? thinkingMode === 'deep'
                        ? 'text-purple-400'
                        : 'text-indigo-300'
                      : 'text-gray-500'
                  }
                  strokeWidth={2}
                />
              <span>{thinkingMode === 'deep' ? '深度思考' : thinkingMode === 'light' ? '浅思考' : '思考'}</span>
                {!isQwenChatUiModel(selectedModel) && thinkingMode !== 'off' && (
                  <div
                    className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                      thinkingMode === 'deep' ? 'bg-purple-400' : 'bg-indigo-300'
                    }`}
                  ></div>
                )}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-gray-800/60 rounded-xl border border-gray-700/50 px-3 py-2">
          {/* ??????*/}
          <textarea
            value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // ??????
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            onPaste={(e) => {
              const plain = e.clipboardData?.getData('text/plain');
              if (typeof plain !== 'string') return;
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart ?? input.length;
              const end = target.selectionEnd ?? input.length;
              const next = input.slice(0, start) + plain + input.slice(end);
              setInput(next);
              requestAnimationFrame(() => {
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                const pos = start + plain.length;
                target.setSelectionRange(pos, pos);
              });
            }}
            onKeyPress={handleKeyPress}
              placeholder="输入消息… Enter 发送，Shift+Enter 换行"
              className="flex-1 bg-transparent border-none text-white text-sm resize-y focus:outline-none placeholder:text-gray-500 min-h-[40px] max-h-[120px] py-2 custom-scrollbar"
              rows={1}
              disabled={isLoading}
            />
            
            {/* ?????- ???????????222.png??*/}
          <button
            onClick={handleSend}
              className="p-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white disabled:bg-gray-700 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center shadow-lg hover:shadow-green-500/30 active:scale-95"
              disabled={(input.trim() === '' && !referencedImage && attachedImages.length === 0) || isLoading}
            title="发送消息"
          >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" strokeWidth={2.5} />
              ) : (
                <Send size={18} strokeWidth={2.5} className="rotate-[-45deg]" />
              )}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
});
