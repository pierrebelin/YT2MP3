// Application mono-page, JS vanilla. Aucun script tiers, aucune requête hors même origine.
import { parseYoutubeUrl } from './shared/youtube-url.js';
import { sanitizeFilename, MAX_FILENAME_LENGTH, FILENAME_WARN_LENGTH, PRESET_LABELS } from './shared/filename.js';
import { createTranslator } from './i18n.js';

const $ = (id) => document.getElementById(id);

const el = {
  lang: $('lang'),
  theme: $('theme-toggle'),
  form: $('url-form'),
  url: $('url'),
  analyze: $('analyze'),
  urlError: $('url-error'),
  urlNote: $('url-note'),
  preview: $('preview'),
  thumb: $('preview-thumb'),
  previewTitle: $('preview-title'),
  previewMeta: $('preview-meta'),
  previewSource: $('preview-source'),
  previewOutput: $('preview-output'),
  qualityInfo: $('quality-info'),
  qualityNote: $('quality-note'),
  options: $('options'),
  presetList: $('preset-list'),
  filename: $('filename'),
  filenameExt: $('filename-ext'),
  filenameReset: $('filename-reset'),
  filenameUndo: $('filename-undo'),
  filenameCounter: $('filename-counter'),
  filenameError: $('filename-error'),
  formatList: $('format-list'),
  formatNotice: $('format-notice'),
  compatBody: $('compat-body'),
  embedCover: $('embed-cover'),
  convert: $('convert'),
  progressPanel: $('progress-panel'),
  progressbar: $('progressbar'),
  progressFill: $('progress-fill'),
  progressPhase: $('progress-phase'),
  cancel: $('cancel'),
  failure: $('failure'),
  failureMessage: $('failure-message'),
  failureRetry: $('failure-retry'),
  failureRestart: $('failure-restart'),
  toast: $('toast'),
  live: $('live-region'),
};

const STORAGE = {
  lang: 'yt2mp3.lang',
  theme: 'yt2mp3.theme',
  preset: 'yt2mp3.preset',
  format: 'yt2mp3.outputFormat',
};

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : on continue sans mémoriser */
    }
  },
};

let lang = store.get(STORAGE.lang) || (navigator.language || 'fr').slice(0, 2).toLowerCase();
if (lang !== 'en') lang = 'fr';
let t = createTranslator(lang);

const state = {
  analysis: null,
  presets: [],
  selectedPreset: null,
  filename: '',
  previousCustom: null,
  undoTimer: null,
  format: store.get(STORAGE.format) || 'mp3-320',
  job: null,
  source: null, // EventSource
  toastTimer: null,
};

// --- Internationalisation -------------------------------------------------------------------

function applyStaticTranslations() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
}

function announce(message) {
  el.live.textContent = message;
}

// --- Formatage ------------------------------------------------------------------------------

function formatBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(mb)} ${lang === 'en' ? 'MB' : 'Mo'}`;
}

function localized(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : value[lang] || value.fr;
}

// --- Appels réseau ---------------------------------------------------------------------------

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': lang,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw { code: 'NETWORK', message: t('error.network'), retryable: true };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw payload?.error || { code: 'UNKNOWN', message: `HTTP ${response.status}`, retryable: false };
  }
  return payload;
}

// --- Zone 1 : saisie d'URL --------------------------------------------------------------------

function validateUrl() {
  const raw = el.url.value.trim();
  if (!raw) {
    el.analyze.disabled = true;
    hide(el.urlError);
    hide(el.urlNote);
    return null;
  }
  const { videoId, hadPlaylist } = parseYoutubeUrl(raw);
  el.analyze.disabled = !videoId;

  if (!videoId) {
    el.urlError.textContent = t('url.invalid');
    show(el.urlError);
    hide(el.urlNote);
    return null;
  }
  hide(el.urlError);
  if (hadPlaylist) {
    el.urlNote.textContent = t('url.playlist'); // F-04
    show(el.urlNote);
  } else {
    hide(el.urlNote);
  }
  return videoId;
}

async function analyzeCurrentUrl() {
  const videoId = validateUrl();
  if (!videoId) return;

  el.analyze.disabled = true;
  el.analyze.textContent = t('url.analyzing');
  el.preview.setAttribute('aria-busy', 'true');
  hide(el.failure);

  try {
    const analysis = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ url: el.url.value.trim() }) });
    state.analysis = analysis;
    renderAnalysis();
  } catch (error) {
    showFailure(error, { retryable: false });
  } finally {
    el.analyze.disabled = false;
    el.analyze.textContent = t('url.submit');
    el.preview.removeAttribute('aria-busy');
  }
}

// --- Zone 2 : aperçu vidéo ----------------------------------------------------------------------

function renderPreview() {
  const a = state.analysis;
  el.thumb.src = a.thumbnailUrl;
  el.thumb.alt = a.title;
  el.previewTitle.textContent = a.title;

  const parts = [a.channel, a.durationLabel];
  if (a.year) parts.push(String(a.year));
  el.previewMeta.textContent = parts.join(' · ');

  const source = a.source;
  el.previewSource.textContent = `${codecLabel(source.codec)} ~${source.bitrateKbps} kbps, ${formatHz(source.sampleRateHz)}`;
  show(el.preview);
  renderOutputLine();
}

function codecLabel(codec = '') {
  const c = codec.toLowerCase();
  if (c.startsWith('opus')) return 'Opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'AAC';
  if (c.startsWith('mp3')) return 'MP3';
  return codec;
}

function formatHz(hz) {
  if (!hz) return '—';
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(hz / 1000)} kHz`;
}

// Ligne « Fichier produit » : le format réellement retenu, jamais une valeur générique (§6.7).
function renderOutputLine() {
  const entry = currentFormat();
  if (!entry) return;
  const bits = [];
  if (entry.container === 'm4a') bits.push(`M4A ${entry.bitrateKbps} kbps`);
  else bits.push(`MP3 ${entry.bitrateKbps} kbps`);
  if (entry.sampleRateHz) bits.push(formatHz(entry.sampleRateHz));

  const line = `${bits.join(', ')} — ${entry.reencoded ? t('preview.compatible') : `${t('preview.copy')}, ${t('preview.compatible')}`}`;
  el.previewOutput.textContent = line;
}

// --- Zone 3a : sélecteur de nom (§8.3) ------------------------------------------------------------

function renderPresets() {
  const a = state.analysis;
  state.presets = a.naming.presets.map((preset) => ({
    ...preset,
    label: PRESET_LABELS[preset.key]?.[lang] || preset.key,
  }));

  el.presetList.textContent = '';
  for (const preset of state.presets) {
    const label = document.createElement('label');
    label.className = 'preset';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'filename-preset';
    input.value = preset.key;
    input.checked = preset.key === state.selectedPreset;
    input.addEventListener('change', () => selectPreset(preset.key));

    const body = document.createElement('span');
    body.className = 'preset-body';

    const title = document.createElement('span');
    title.className = 'preset-label';
    title.textContent = preset.label;

    const value = document.createElement('span');
    value.className = 'preset-value';
    value.textContent = preset.value;
    value.title = preset.value;

    body.append(title, value);
    label.append(input, body);
    el.presetList.append(label);
  }
}

function presetByKey(key) {
  return state.presets.find((preset) => preset.key === key) || null;
}

function pickDefaultPreset() {
  const remembered = store.get(STORAGE.preset); // R2
  if (remembered && remembered !== 'custom' && presetByKey(remembered)) return remembered;
  const fallback = state.analysis.naming.defaultPreset; // R1
  return presetByKey(fallback) ? fallback : state.presets[0]?.key;
}

function selectPreset(key, { remember = true } = {}) {
  const preset = presetByKey(key);
  if (!preset) return;

  // Mitigation §8.3.1 : la saisie personnalisée reste récupérable 8 secondes.
  if (state.selectedPreset === 'custom' && state.filename) {
    state.previousCustom = state.filename;
    show(el.filenameUndo);
    clearTimeout(state.undoTimer);
    state.undoTimer = setTimeout(() => hide(el.filenameUndo), 8000);
  }

  state.selectedPreset = key;
  state.filename = preset.value;
  el.filename.value = preset.value;
  if (remember) store.set(STORAGE.preset, key);
  syncFilenameUi();
}

function markCustom() {
  state.selectedPreset = 'custom';
  state.filename = el.filename.value;
  for (const input of el.presetList.querySelectorAll('input')) input.checked = false;
  syncFilenameUi();
}

function syncFilenameUi() {
  const length = state.filename.length;
  el.filenameCounter.textContent = t('filename.counter', { n: length });
  el.filenameCounter.classList.toggle('warn', length > FILENAME_WARN_LENGTH);
  el.filenameCounter.classList.toggle('over', length > MAX_FILENAME_LENGTH);

  const empty = state.filename.trim().length === 0;
  el.filenameError.hidden = !empty;
  el.convert.disabled = empty;
  el.filenameReset.hidden = state.selectedPreset !== 'custom';

  const entry = currentFormat();
  el.filenameExt.textContent = entry?.extension || '.mp3';
}

// --- Zone 3b : sélecteur de format (§13.3) -----------------------------------------------------

function currentFormat() {
  return state.analysis?.formats.find((f) => f.key === state.format) || null;
}

function renderFormats() {
  const formats = state.analysis.formats;
  const selected = formats.find((f) => f.key === state.format);

  // Une sélection mémorisée devenue indisponible retombe sur `mp3-320` (F-43).
  if (!selected || !selected.available) {
    state.format = 'mp3-320';
    el.formatNotice.textContent = t('format.fallback');
    show(el.formatNotice);
  } else {
    hide(el.formatNotice);
  }

  el.formatList.textContent = '';
  for (const format of formats) {
    const label = document.createElement('label');
    label.className = 'preset';
    if (!format.available) label.classList.add('is-disabled');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'output-format';
    input.value = format.key;
    input.checked = format.key === state.format;
    input.disabled = !format.available;
    const describedBy = `format-desc-${format.key}`;
    input.setAttribute('aria-describedby', describedBy);
    input.addEventListener('change', () => selectFormat(format.key));

    const body = document.createElement('span');
    body.className = 'preset-body';

    const head = document.createElement('span');
    head.className = 'preset-head';

    const title = document.createElement('span');
    title.className = 'preset-label';
    title.textContent = localized(format.label);

    const aside = document.createElement('span');
    aside.className = 'preset-aside';
    aside.textContent = format.available
      ? format.estimatedSizeBytes
        ? `~${formatBytes(format.estimatedSizeBytes)}`
        : ''
      : t('format.unavailable');

    head.append(title, aside);

    const description = document.createElement('span');
    description.className = 'preset-desc';
    description.id = describedBy;
    description.textContent = localized(format.description);

    body.append(head, description);

    label.append(input, body);
    el.formatList.append(label);
  }

  renderCompatTable(formats);
  updateConvertLabel();
}

// Le tableau compare les formats réellement proposés pour cette vidéo, pas des familles
// de conteneurs abstraites : sinon il ne sert à rien au moment de choisir.
function renderCompatTable(formats) {
  el.compatBody.textContent = '';

  for (const format of formats) {
    const row = document.createElement('tr');
    if (!format.available) row.classList.add('is-disabled');

    const bitrate = format.bitrateKbps
      ? `${format.container === 'm4a' ? 'AAC ' : ''}${format.bitrateKbps} kbps${format.key === 'mp3-v0' ? ` (${t('format.table.vbr')})` : ''}`
      : '—';

    const cells = format.available
      ? [
          localized(format.label),
          bitrate,
          format.estimatedSizeBytes ? `~${formatBytes(format.estimatedSizeBytes)}` : '—',
          format.reencoded ? t('format.table.yes') : t('format.table.no'),
          '✅',
        ]
      : [localized(format.label), '—', '—', '—', t('format.unavailable')];

    for (const value of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    el.compatBody.append(row);
  }
}

function selectFormat(key) {
  state.format = key;
  store.set(STORAGE.format, key);
  hide(el.formatNotice);
  syncFilenameUi(); // met à jour le suffixe d'extension, jamais le nom saisi
  renderOutputLine();
  updateConvertLabel();
}

function updateConvertLabel() {
  const entry = currentFormat();
  if (!entry) return;
  const label = entry.key === 'm4a-copy' ? 'M4A' : entry.key === 'mp3-v0' ? 'MP3 V0' : 'MP3 320 kbps';
  el.convert.textContent = t('options.convert', { format: label });
}

// --- Rendu global de l'analyse -------------------------------------------------------------------

function renderAnalysis() {
  hide(el.progressPanel);
  hide(el.failure);

  state.previousCustom = null;
  hide(el.filenameUndo);

  renderPreview();
  state.selectedPreset = null;
  renderPresets();
  const defaultKey = pickDefaultPreset();
  selectPreset(defaultKey, { remember: false });
  renderPresets(); // relance pour cocher le bon radio
  renderFormats();
  el.embedCover.checked = state.analysis.embedCoverDefault !== false;
  show(el.options);
  syncFilenameUi();
}

// --- Zone 4 : conversion ---------------------------------------------------------------------------

async function startConversion() {
  const filename = sanitizeFilename(state.filename, state.analysis.videoId);
  if (!filename) return;

  el.convert.disabled = true;
  hide(el.failure);

  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        videoId: state.analysis.videoId,
        filename,
        outputFormat: state.format,
        embedCover: el.embedCover.checked,
      }),
    });
    trackJob(job);
  } catch (error) {
    el.convert.disabled = false;
    if (error.code === 'FORMAT_UNAVAILABLE') {
      state.format = 'mp3-320';
      store.set(STORAGE.format, 'mp3-320');
      renderFormats();
    }
    showFailure(error);
  }
}

function trackJob(job) {
  state.job = job;
  location.hash = `#/job/${job.jobId}`;
  show(el.progressPanel);
  renderJob(job);
  openStream(job.jobId);
}

function openStream(jobId) {
  closeStream();
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  state.source = source;

  const onData = (event) => {
    const payload = JSON.parse(event.data);
    state.job = { ...state.job, ...payload };
    renderJob(state.job);
  };

  source.addEventListener('progress', onData);
  source.addEventListener('ready', (event) => {
    onData(event);
    closeStream();
  });
  source.addEventListener('cancelled', (event) => {
    onData(event);
    closeStream();
  });
  source.addEventListener('error', (event) => {
    if (event.data) {
      onData(event);
      closeStream();
      return;
    }
    // Coupure réseau : repli sur une consultation ponctuelle (§11.3).
    closeStream();
    pollJob(jobId);
  });
}

function closeStream() {
  state.source?.close();
  state.source = null;
}

async function pollJob(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    state.job = job;
    renderJob(job);
    if (!['ready', 'failed', 'cancelled', 'expired'].includes(job.state)) {
      setTimeout(() => pollJob(jobId), 2000);
    }
  } catch (error) {
    showFailure(error);
  }
}

const PHASE_KEYS = {
  downloading: 'progress.downloading',
  encoding: 'progress.encoding',
  tagging: 'progress.tagging',
};

function renderJob(job) {
  if (job.state === 'ready') return showResult(job);
  if (job.state === 'failed') return showFailure(job.error || {}, { retryable: job.error?.retryable });
  if (job.state === 'cancelled') return showCancelled();
  if (job.state === 'expired') return showFailure({ code: 'FILE_EXPIRED', message: t('result.expired') });

  show(el.progressPanel);
  el.progressFill.style.width = `${job.progress}%`;
  el.progressbar.setAttribute('aria-valuenow', String(job.progress));

  const label =
    job.state === 'queued'
      ? t('progress.queued', { n: job.queuePosition ?? 1, total: job.queueLength || job.queuePosition || 1 })
      : t(PHASE_KEYS[job.phase] || 'progress.downloading');
  el.progressPhase.textContent = `${label} ${job.state === 'queued' ? '' : `${job.progress} %`}`.trim();
  el.progressbar.classList.toggle('indeterminate', job.state === 'queued');
}

// Le fichier n'existe sur le serveur que le temps d'un unique téléchargement : pas de panneau
// de résultat, pas de second lien. On déclenche, on remonte, on confirme.
function showResult(job) {
  hide(el.progressPanel);
  hide(el.failure);
  el.convert.disabled = false;

  if (job.autoDownloaded) return;
  job.autoDownloaded = true;

  const link = document.createElement('a');
  link.href = job.downloadUrl;
  link.download = job.filename;
  document.body.append(link);
  link.click();
  link.remove();

  location.hash = '';
  // Défilement immédiat : un `behavior: 'smooth'` est annulé par le déclenchement du download.
  window.scrollTo({ top: 0 });
  showToast(t('toast.downloaded', { title: state.analysis?.title || job.filename }));
}

const TOAST_DURATION_MS = 2500;

function showToast(message) {
  el.toast.textContent = message;
  show(el.toast);
  // Un cadre d'animation sépare l'affichage de la classe : sinon la transition ne joue pas.
  requestAnimationFrame(() => el.toast.classList.add('is-visible'));
  announce(message);

  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
    state.toastTimer = setTimeout(() => hide(el.toast), 250);
  }, TOAST_DURATION_MS);
}

function showCancelled() {
  hide(el.progressPanel);
  el.convert.disabled = false;
  announce(t('progress.cancelled'));
  el.urlNote.textContent = t('progress.cancelled');
  show(el.urlNote);
  location.hash = '';
}

function showFailure(error, { retryable = error?.retryable } = {}) {
  hide(el.progressPanel);
  el.convert.disabled = false;
  el.failureMessage.textContent = error?.message || t('error.network');
  el.failureRetry.hidden = !retryable;
  show(el.failure);
  announce(el.failureMessage.textContent);
}

async function cancelCurrentJob() {
  if (!state.job) return;
  closeStream();
  try {
    await api(`/api/jobs/${state.job.jobId}`, { method: 'DELETE' });
  } catch {
    /* déjà terminé : l'état affiché sera corrigé au prochain rendu */
  }
  showCancelled();
}

function restart() {
  closeStream();
  state.job = null;
  state.analysis = null;
  location.hash = '';
  hide(el.preview);
  hide(el.options);
  hide(el.progressPanel);
  hide(el.failure);
  el.url.value = '';
  el.url.focus();
  el.analyze.disabled = true;
}

// --- Utilitaires d'affichage --------------------------------------------------------------------

function show(node) {
  node.hidden = false;
}
function hide(node) {
  node.hidden = true;
}

// --- Thème --------------------------------------------------------------------------------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el.theme.setAttribute('aria-pressed', String(theme === 'dark'));
  el.theme.firstElementChild.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// --- Câblage -------------------------------------------------------------------------------------

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  analyzeCurrentUrl();
});

el.url.addEventListener('input', validateUrl);
el.url.addEventListener('paste', () => {
  // F-05 : le collage d'une URL valide déclenche l'analyse.
  setTimeout(() => {
    if (validateUrl()) analyzeCurrentUrl();
  }, 0);
});

el.filename.addEventListener('input', () => {
  if (el.filename.value.length > MAX_FILENAME_LENGTH) {
    el.filename.value = el.filename.value.slice(0, MAX_FILENAME_LENGTH);
  }
  markCustom();
});

el.filenameReset.addEventListener('click', () => {
  selectPreset(pickDefaultPreset());
  renderPresets();
});

el.filenameUndo.addEventListener('click', () => {
  if (state.previousCustom === null) return;
  el.filename.value = state.previousCustom;
  markCustom();
  hide(el.filenameUndo);
  el.filename.focus();
});

el.qualityInfo.addEventListener('click', () => {
  const expanded = el.qualityInfo.getAttribute('aria-expanded') === 'true';
  el.qualityInfo.setAttribute('aria-expanded', String(!expanded));
  el.qualityNote.hidden = expanded;
});

el.convert.addEventListener('click', startConversion);
el.cancel.addEventListener('click', cancelCurrentJob);
el.failureRestart.addEventListener('click', restart);
el.failureRetry.addEventListener('click', () => {
  if (state.analysis) startConversion();
  else analyzeCurrentUrl();
});

el.lang.addEventListener('change', () => {
  lang = el.lang.value;
  t = createTranslator(lang);
  store.set(STORAGE.lang, lang);
  applyStaticTranslations();
  if (state.analysis) {
    renderPresets();
    renderFormats();
    renderOutputLine();
    syncFilenameUi();
  }
  if (state.job) renderJob(state.job);
});

el.theme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set(STORAGE.theme, next);
  applyTheme(next);
});

// --- Démarrage ------------------------------------------------------------------------------------

function boot() {
  el.lang.value = lang;
  applyStaticTranslations();

  const theme = store.get(STORAGE.theme) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);

  // Restauration d'un job en cours après fermeture de l'onglet (§4.2).
  const match = /^#\/job\/([A-Za-z0-9_]+)$/.exec(location.hash);
  if (match) {
    show(el.progressPanel);
    pollJob(match[1]);
    api(`/api/jobs/${match[1]}`)
      .then((job) => {
        state.job = job;
        if (!['ready', 'failed', 'cancelled', 'expired'].includes(job.state)) openStream(job.jobId);
      })
      .catch(() => {});
  }

  el.url.focus();
}

boot();
