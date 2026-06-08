/**
 * 后端专用：将 @主图、@图片1 等展开为与 API 入参顺序一致的中文说明。
 * 与前端 utils/promptMediaRefs 的素材枚举规则对齐；媒体 URL 仍由各模型专用字段传递。
 */

function isLikelyMainVideoUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  const u = url.trim();
  if (/^data:video\//i.test(u)) return true;
  if (/\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(u)) return true;
  if (/[?&]type=video\b/i.test(u)) return true;
  return false;
}

function isOmniMixedRefItemVideo(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:image/')) return false;
  return isLikelyMainVideoUrl(url);
}

function pushMainImage(refs) {
  refs.push({ label: '主图', kind: 'mainImage', insertText: '@主图' });
}
function pushMainVideo(refs) {
  refs.push({ label: '主视频', kind: 'mainVideo', insertText: '@主视频' });
}
function pushImage(refs, i, extras) {
  const label = `图片${i}`;
  const item = { label, kind: 'image', insertText: `@${label}` };
  if (extras && typeof extras === 'object') {
    if (extras.refImageIndex !== undefined) item.refImageIndex = extras.refImageIndex;
    if (extras.refFrameIndex !== undefined) item.refFrameIndex = extras.refFrameIndex;
  }
  refs.push(item);
}
function pushVideo(refs, i) {
  const label = `视频${i}`;
  refs.push({ label, kind: 'video', insertText: `@${label}` });
}
function pushAudio(refs, i) {
  const label = `音频${i}`;
  refs.push({ label, kind: 'audio', insertText: `@${label}` });
}

function maybePushMainPreview(data, refs) {
  const p = data.imagePreview?.trim?.();
  if (!p) return;
  if (isLikelyMainVideoUrl(p)) pushMainVideo(refs);
  else pushMainImage(refs);
}

export function buildPromptMediaRefLabels(data, ctx) {
  const refs = [];
  let imgCount = 0;
  let vidCount = 0;
  let audCount = 0;
  const nextImage = () => {
    imgCount += 1;
    pushImage(refs, imgCount);
  };
  const nextVideo = () => {
    vidCount += 1;
    pushVideo(refs, vidCount);
  };
  const nextAudio = () => {
    audCount += 1;
    pushAudio(refs, audCount);
  };

  if (ctx.isKelingOmni) {
    maybePushMainPreview(data, refs);
    const tab = ctx.klingOmniTab;
    const prev = data.imagePreview?.trim?.();
    if (tab === 'frames') {
      let ord = 0;
      if (data.firstFrameImage || data.firstFrameImageUrl) {
        const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
        if (!(u && prev && u === prev && !isLikelyMainVideoUrl(prev))) {
          ord += 1;
          pushImage(refs, ord, { refFrameIndex: 0 });
        }
      }
      if (data.lastFrameImage || data.lastFrameImageUrl) {
        ord += 1;
        pushImage(refs, ord, { refFrameIndex: 1 });
      }
    } else if (tab === 'multi') {
      const imgs = data.klingOmniMultiReferenceImages || [];
      if (imgs.length > 0) {
        let imgOrd = 0;
        let vidOrd = 0;
        imgs.forEach((url, idx) => {
          if (isOmniMixedRefItemVideo(url)) {
            vidOrd += 1;
            pushVideo(refs, vidOrd);
            return;
          }
          if (idx === 0 && prev && url === prev && !isLikelyMainVideoUrl(prev)) return;
          imgOrd += 1;
          pushImage(refs, imgOrd, { refImageIndex: idx });
        });
      }
    } else if (tab === 'instruction' || tab === 'video') {
      const imgs =
        tab === 'instruction'
          ? data.klingOmniInstructionReferenceImages || []
          : data.klingOmniVideoReferenceImages || [];
      let imgOrd = 0;
      let vidOrd = 0;
      if (imgs.length > 0) {
        imgs.forEach((url, idx) => {
          if (isOmniMixedRefItemVideo(url)) {
            vidOrd += 1;
            pushVideo(refs, vidOrd);
            return;
          }
          if (idx === 0 && prev && url === prev && !isLikelyMainVideoUrl(prev)) return;
          imgOrd += 1;
          pushImage(refs, imgOrd, { refImageIndex: idx });
        });
      }
      const hasVid =
        tab === 'instruction'
          ? Boolean(data.klingOmniInstructionVideoPreviewUrl || data.klingOmniInstructionVideoUrl)
          : Boolean(data.klingOmniVideoPreviewUrl || data.klingOmniVideoUrl);
      if (hasVid && vidOrd === 0) nextVideo();
    }
    return refs;
  }

  if (ctx.isJimeng) {
    maybePushMainPreview(data, refs);
    const imgs = data.jimengImages || [];
    const prev = data.imagePreview?.trim?.();
    if (imgs.length > 0) {
      let manualOrdinal = 0;
      imgs.forEach((url, idx) => {
        if (idx === 0 && prev && url === prev && !isLikelyMainVideoUrl(prev)) return;
        manualOrdinal += 1;
        pushImage(refs, manualOrdinal, { refImageIndex: idx });
      });
    } else if (data.firstFrameImage || data.firstFrameImageUrl) {
      const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
      if (!(u && prev && u === prev && !isLikelyMainVideoUrl(prev))) {
        nextImage();
      }
    }
    return refs;
  }

  if (ctx.isNano) {
    maybePushMainPreview(data, refs);
    const imgs = data.referenceImages || [];
    const prev = data.imagePreview?.trim?.();
    let manualOrdinal = 0;
    imgs.forEach((url, idx) => {
      if (idx === 0 && prev && url === prev && !isLikelyMainVideoUrl(prev)) return;
      manualOrdinal += 1;
      pushImage(refs, manualOrdinal, { refImageIndex: idx });
    });
    return refs;
  }

  if (ctx.isSeedance20) {
    maybePushMainPreview(data, refs);
    if (ctx.seedanceMode === 'image') {
      const prev = data.imagePreview?.trim?.();
      let ord = 0;
      if (data.firstFrameImage || data.firstFrameImageUrl) {
        const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
        if (!(u && prev && u === prev && !isLikelyMainVideoUrl(prev))) {
          ord += 1;
          pushImage(refs, ord, { refFrameIndex: 0 });
        }
      }
      if (data.lastFrameImage || data.lastFrameImageUrl) {
        ord += 1;
        pushImage(refs, ord, { refFrameIndex: 1 });
      }
      return refs;
    }
    if (ctx.seedanceMode === 'reference') {
      const imgs = data.referenceImages || [];
      const prev = data.imagePreview?.trim?.();
      if (imgs.length > 0) {
        let manualOrdinal = 0;
        imgs.forEach((url, idx) => {
          if (
            idx === 0 &&
            prev &&
            url === prev &&
            !isLikelyMainVideoUrl(prev)
          ) {
            return;
          }
          manualOrdinal += 1;
          pushImage(refs, manualOrdinal, { refImageIndex: idx });
        });
      } else if (data.firstFrameImage || data.firstFrameImageUrl) {
        const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
        if (!(u && prev && u === prev && !isLikelyMainVideoUrl(prev))) {
          nextImage();
        }
      }
      (data.referenceMovs || []).forEach(() => nextVideo());
      (data.referenceAudios || []).forEach(() => nextAudio());
      return refs;
    }
    return refs;
  }

  if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
    maybePushMainPreview(data, refs);
    const prev = data.imagePreview?.trim?.();
    let ord = 0;
    if (data.firstFrameImage || data.firstFrameImageUrl) {
      const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
      if (!(u && prev && u === prev && !isLikelyMainVideoUrl(prev))) {
        ord += 1;
        pushImage(refs, ord, { refFrameIndex: 0 });
      }
    }
    if (data.lastFrameImage || data.lastFrameImageUrl) {
      ord += 1;
      pushImage(refs, ord, { refFrameIndex: 1 });
    }
    return refs;
  }

  return refs;
}

export function buildPromptMediaRefContextFromNode(data) {
  const model = data.selectedModel || '';
  const isKelingOmni = model === '可灵3.0 Omni';
  const isJimeng = model === '即梦3.0 Pro';
  const isVidu = model === 'vidu 2.0';
  const isSeedance15 = model === 'seedance1.5-pro';
  const isSeedance20 = model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)';
  const isSeedance = isSeedance15 || isSeedance20;
  const isKelingNonOmni =
    (model.includes('可灵') || model.includes('Keling')) && !isKelingOmni;
  const isNano = !isKelingNonOmni && !isJimeng && !isVidu && !isSeedance && !isKelingOmni;
  return {
    isKelingOmni,
    klingOmniTab: data.klingOmniTab || 'multi',
    isJimeng,
    isNano,
    isKeling: Boolean(isKelingNonOmni),
    isVidu,
    isSeedance15,
    isSeedance20,
    seedanceMode: data.seedanceGenerationMode || 'text',
  };
}

function expansionPhraseForRef(item, data, ctx) {
  switch (item.kind) {
    case 'mainImage':
      return '（本节点主预览图，对应本请求主图/主预览输入）';
    case 'mainVideo':
      return '（本节点主预览视频素材，对应本请求主视频输入）';
    case 'image': {
      const n = item.label.replace(/^图片/, '') || '?';
      if (item.refFrameIndex === 0) {
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames')
          return '（首帧图，对应本请求首帧/第一张图）';
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') return '（首帧图，对应本请求 startImage）';
        if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15)
          return '（首帧图，对应本请求首帧/第一张图）';
      }
      if (item.refFrameIndex === 1) {
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames')
          return '（尾帧图，对应本请求尾帧/第二张图）';
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') return '（尾帧图，对应本请求 endImage）';
        if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15)
          return '（尾帧图，对应本请求尾帧/第二张图）';
      }
      if (item.refImageIndex != null) {
        const apiN = item.refImageIndex + 1;
        if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
          return `（面板参考「${item.label}」，对应本请求 referenceImages 第${apiN}项）`;
        }
        if (ctx.isNano) {
          return `（面板参考「${item.label}」，对应本请求 imageUrls 第${apiN}项）`;
        }
        if (ctx.isJimeng) {
          return `（面板参考「${item.label}」，对应本请求即梦参考图列表第${apiN}项）`;
        }
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'multi') {
          return `（面板参考「${item.label}」，对应本请求 Omni 多图参考第${apiN}项）`;
        }
        if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
          return `（面板参考「${item.label}」，对应本请求当前 tab 参考图第${apiN}项）`;
        }
        return `（面板参考「${item.label}」，与本请求参考图入参第${apiN}项一致）`;
      }
      if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames') {
        if (item.label === '图片1') return '（首帧图，对应本请求首帧/第一张图）';
        if (item.label === '图片2') return '（尾帧图，对应本请求尾帧/第二张图）';
      }
      if (ctx.isKelingOmni && ctx.klingOmniTab === 'multi') {
        return `（参考图第${n}张，对应本请求中接在首帧后的第${n}张参考图）`;
      }
      if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
        return `（参考图第${n}张，对应本请求参考图序列第${n}张）`;
      }
      if (ctx.isNano) {
        return `（参考图第${n}张，对应本请求 imageUrls 中主图之后的第${n}张）`;
      }
      if (ctx.isJimeng) {
        return `（面板参考图第${n}张；即梦任务实际提交的为首帧图，与面板所选顺序一致）`;
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
        if (item.label === '图片1') return '（首帧图，对应本请求 startImage）';
        if (item.label === '图片2') return '（尾帧图，对应本请求 endImage）';
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
        return `（参考图第${n}张，对应本请求 referenceImages 第${n}张）`;
      }
      if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
        if (item.label === '图片1') return '（首帧图，对应本请求首帧/第一张图）';
        if (item.label === '图片2') return '（尾帧图，对应本请求尾帧/第二张图）';
      }
      return `（参考图第${n}张）`;
    }
    case 'video': {
      const n = item.label.replace(/^视频/, '') || '?';
      if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
        return `（参考视频第${n}段，对应本请求参考视频第${n}段）`;
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
        return `（参考视频第${n}段，对应本请求 referenceVideos 第${n}段）`;
      }
      return `（参考视频第${n}段）`;
    }
    case 'audio': {
      const n = item.label.replace(/^音频/, '') || '?';
      return `（参考音频第${n}段，对应本请求 referenceAudios 第${n}段）`;
    }
    default:
      return '';
  }
}

/**
 * @param {string} userPrompt
 * @param {object} data - 与前端 NodeData 同结构的 JSON
 * @param {object} [ctx] - 可选；缺省则从 data 推导
 * @param {{ subjectCaption?: string }} [options]
 */
export function resolvePromptPlaceholders(userPrompt, data, ctx, options) {
  if (userPrompt == null || userPrompt === '') return userPrompt;
  const c = ctx || buildPromptMediaRefContextFromNode(data);
  const items = buildPromptMediaRefLabels(data, c);
  const pairs = [];
  for (const it of items) {
    const phrase = expansionPhraseForRef(it, data, c);
    if (phrase) pairs.push({ token: it.insertText, phrase });
  }
  const mainPhrase = items.find((i) => i.insertText === '@主图');
  if (mainPhrase) {
    pairs.push({
      token: '@主体',
      phrase:
        options?.subjectCaption?.trim?.()
          ? `（主体：${String(options.subjectCaption).trim()}，同本请求主预览图）`
          : expansionPhraseForRef(mainPhrase, data, c),
    });
  } else if (options?.subjectCaption?.trim?.()) {
    pairs.push({
      token: '@主体',
      phrase: `（主体：${String(options.subjectCaption).trim()}）`,
    });
  }
  const img1 = items.find((i) => i.kind === 'image' && i.label === '图片1')
  if (img1) pairs.push({ token: '@图片', phrase: expansionPhraseForRef(img1, data, c) })
  const vid1 = items.find((i) => i.kind === 'video' && i.label === '视频1')
  if (vid1) pairs.push({ token: '@视频', phrase: expansionPhraseForRef(vid1, data, c) })
  const aud1 = items.find((i) => i.kind === 'audio' && i.label === '音频1')
  if (aud1) pairs.push({ token: '@音频', phrase: expansionPhraseForRef(aud1, data, c) })

  pairs.sort((a, b) => b.token.length - a.token.length)
  let out = userPrompt;
  for (const { token, phrase } of pairs) {
    if (!token) continue;
    out = out.split(token).join(phrase);
  }
  return out;
}
