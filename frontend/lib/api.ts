export interface VideoInfo {
  fps: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}

export interface Video {
  id: number;
  filename: string;
  storage_path: string;
  size_bytes: number;
  duration_sec: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  recorded_at?: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  user_id?: number | null;
}

export interface HealthState {
  label: 'happy' | 'good' | 'caution' | 'danger';
  score: number;
  color: string;
  message: string;
  water_stress: number | null;
  wrinkled_fruit_count: number;
  details: string;
  trend?: 'up' | 'down' | 'flat';
  advice?: string[];
  period_n?: number;
  total_n?: number;
  latest_score?: number;
  latest_at?: string | null;
}

export interface ObservationOwner {
  id: number;
  username: string;
  display_name?: string | null;
  farm_name?: string | null;
}

export interface Observation {
  id: number;
  video_id: number;
  timestamp_sec: number;
  label: string | null;
  observed_at: string;
  filename: string;
  leaf_count: number | null;
  fruit_count: number | null;
  green_coverage: number | null;
  overall_health_score: number | null;
  water_stress: number | null;
  leaf_curl_index: number | null;
  wrinkled_fruit_count: number | null;
  annotated_path: string | null;
  raw_frame_path: string | null;
  health_state?: HealthState;
  result?: Record<string, any>;
  user_id?: number | null;
  owner?: ObservationOwner | null;
  explain_text?: string | null;
  image_id?: number | null;
  source_type?: string | null;
  tree_id?: string | null;
  upscaled?: boolean | null;
  upscale_model?: string | null;
}

export interface TreeRecord {
  tree_id: string;
  observation_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

export type MapHealthLabel = 'happy' | 'good' | 'caution' | 'danger';

export interface FarmMapTreeState {
  label: MapHealthLabel;
  score: number;
  message?: string | null;
}

export interface FarmTreeRecord {
  id: number;
  user_id?: number | null;
  tree_id: string;
  name?: string | null;
  variety?: string | null;
  row_num: number;
  col_num: number;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  state?: FarmMapTreeState | null;
  last_seen?: string | null;
  first_seen?: string | null;
  observed_at?: string | null;
  observation_count?: number;
}

export interface FarmMapTree {
  tree_id: string;
  name?: string | null;
  variety?: string | null;
  row: number;
  col: number;
  x: number;
  y: number;
  registered: boolean;
  state: FarmMapTreeState | null;
  observed_at?: string | null;
  last_seen?: string | null;
  first_seen?: string | null;
  observation_count: number;
}

export interface FarmMapData {
  farmer?: { id: number; username?: string | null; display_name?: string | null; farm_name?: string | null } | null;
  map: { width: number; height: number };
  trees: FarmMapTree[];
  registered_count: number;
  unregistered_count: number;
}

export interface TreeRegistryData {
  trees: FarmTreeRecord[];
}

export interface OliveStatus {
  states: Record<string, number>;
  total_observations: number;
  labels: Record<string, { png: string; ja: string; color: string }>;
  latest: Observation | null;
  current_state: HealthState | null;
  current_video: string | null;
  current_timestamp: number | null;
}

export interface ImageAsset {
  id: number;
  filename: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
  recorded_at?: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  user_id?: number | null;
}

export interface SoilMoistureInput {
  sensor1_moisture_percent?: number | null;
  sensor2_moisture_percent?: number | null;
  temperature?: number | null;
  humidity?: number | null;
}

export interface SoilMoistureHealth {
  risk: string;
  message: string;
  weight: number;
  score: number;
}

export interface SoilMoistureData {
  sensor1_moisture_percent?: number | null;
  sensor2_moisture_percent?: number | null;
  temperature?: number | null;
  humidity?: number | null;
  measured_at?: string | null;
  health?: SoilMoistureHealth;
}

export interface SoilAccessStats {
  request_count: number;
  error_count: number;
  last_request_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
}

export interface SoilStatus {
  source: 'api' | 'manual' | 'none' | 'error';
  configured: boolean;
  soil_moisture: SoilMoistureData;
  health: SoilMoistureHealth;
  sensor_online: boolean;
  data_age_hours: number | null;
  api: SoilAccessStats;
  error?: string;
}

export interface SensorAlertState {
  key: string;
  mode: string;
  opened_at: string | null;
  last_sent_at: string | null;
  level: number;
  data: string;
}

export interface SensorAlertEvent {
  id: number;
  mode: string;
  severity: string;
  title: string;
  body: string;
  channels: string;
  created_at: string;
}

export interface SensorAlertEvaluation {
  configured: boolean;
  mode: string;
  sensor_online: boolean;
  severity: string;
  title: string;
  body: string;
  kit_id: string | null;
  measured_at: string | null;
  age_hours: number | null;
  sensor1: number | null;
  sensor2: number | null;
  temperature: number | null;
  humidity: number | null;
  risk: string | null;
  health_message: string | null;
  error: string | null;
  alerts: Record<string, any>;
}

export interface SensorAlertsStatus {
  enabled: boolean;
  configured: boolean;
  evaluation: SensorAlertEvaluation;
  state: SensorAlertState | null;
  events: SensorAlertEvent[];
  channels: Record<string, any>;
}

export interface NotificationTestResult {
  results: { channel: string; ok: boolean; detail?: string | null }[];
  enabled: boolean;
}

export interface TemplatePreviewResult {
  sample: string;
  severity: string;
  title: string;
  body: string;
  text: string;
  payload: Record<string, any>;
}

export interface HealthThresholds {
  happy: number;
  good: number;
  caution: number;
}

export interface SiteSettings {
  name: string;
  subtitle: string;
  accent: string;
}

export interface AppSettings {
  health_thresholds: HealthThresholds;
  site: SiteSettings;
}

export interface AdminStats {
  settings: { health_thresholds: HealthThresholds; site: SiteSettings };
  soil: { configured: boolean; config: Record<string, any>; alerts: Record<string, any>; path: string };
  max_upload_mb: number;
  db: {
    observations: number;
    videos: number;
    images: number;
    video_storage_bytes: number;
    image_storage_bytes: number;
    db_bytes: number;
  };
}

export interface FeatureArchitecture {
  components: ComponentInfo[];
  dataFlows: DataFlow[];
  apiEndpoints: ApiEndpointGroup[];
}

export interface ComponentInfo {
  name: string;
  tech: string;
  description: string;
  port?: string;
}

export interface DataFlow {
  from: string;
  to: string;
  description: string;
}

export interface ApiEndpointGroup {
  group: string;
  endpoints: { path: string; method: string; description: string }[];
}

export interface VersionInfo {
  olive_msystem: { frontend: string; backend: string };
  olive_p: string | null;
  python: string;
  platform: string;
  dependencies: Record<string, string | null>;
  architecture: FeatureArchitecture;
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'farmer' | 'admin';
  display_name?: string | null;
  farm_name?: string | null;
  farm_area?: string | null;
  farm_trees?: number | null;
  farm_variety?: string | null;
  farm_location?: string | null;
  farm_contact?: string | null;
  preferences?: Record<string, any>;
}

export interface CalendarObservation {
  id: number;
  user_id: number;
  observed_at: string;
  health_state: HealthState | null;
  leaf_count: number | null;
  fruit_count: number | null;
  overall_health_score: number | null;
  source: string | null;
  label: string | null;
  farm_name?: string | null;
}

export interface CalendarData {
  year: number;
  month: number;
  observations: Record<string, CalendarObservation[]>;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  target_role: string;
  target_user_id: number | null;
  created_by: number;
  creator_name?: string | null;
  created_at: string;
  is_read: number;
}

export interface FarmerRecord extends AuthUser {
  created_at: string;
  is_active: number;
  video_count: number;
  image_count: number;
  observation_count: number;
  states: Record<'happy' | 'good' | 'caution' | 'danger', number>;
  latest_observed_at?: string | null;
}

export interface AdminOverviewRole {
  users: number;
  user_ids: number[];
  usernames: string[];
  observation_count: number;
  video_count: number;
  image_count: number;
  states: Record<'happy' | 'good' | 'caution' | 'danger', number>;
}

export type AdminOverview = Record<'farmer' | 'admin', AdminOverviewRole>;

export interface AuthState {
  token: string;
  user: AuthUser;
}

// ----- token store (module-level, read by every api helper) -----
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken() {
  return authToken;
}

export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code: string | null;
  constructor(message: string, status: number, retryable = false, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super('認証が必要です。再度ログインしてください。', 401, false);
    this.name = 'UnauthorizedError';
  }
}

export class NetworkError extends ApiError {
  constructor(message: string, retryable = true) {
    super(message, 0, retryable);
    this.name = 'NetworkError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

// Retry policy for idempotent requests (GET/HEAD/OPTIONS): up to
// RETRY_ATTEMPTS total tries with exponential backoff + small jitter so a
// transient 5xx / timeout / hub outage is absorbed without hammering the
// backend (and without clients retrying in lockstep).
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;
const RETRY_JITTER_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isIdempotentMethod(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function backoffDelay(retryIndex: number): number {
  const exponential = Math.min(RETRY_BASE_MS * 2 ** retryIndex, RETRY_MAX_MS);
  return exponential + Math.floor(Math.random() * RETRY_JITTER_MS);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NetworkError('リクエストがタイムアウトしました。バックエンドの状態を確認してください。');
    }
    const msg = err instanceof TypeError
      ? 'サーバーに接続できませんでした。バックエンドが起動しているかご確認ください。'
      : err instanceof Error ? err.message : 'サーバーへの接続に失敗しました。';
    throw new NetworkError(msg);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRetry(
  url: string,
  init: RequestInit,
  opts?: { timeoutMs?: number; retry?: boolean }
): Promise<Response> {
  const retry = opts?.retry ?? true;
  // Mutations are never retried: re-sending a POST/PUT/DELETE that already
  // reached the backend would duplicate the side effect. The guard is
  // enforced here so a caller cannot accidentally enable retries on one.
  const idempotent = isIdempotentMethod(init.method);
  const maxAttempts = retry && idempotent ? RETRY_ATTEMPTS : 1;
  const timeoutMs = opts?.timeoutMs ?? (init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  let lastErr: unknown = null;

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(backoffDelay(i - 1));
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (retry && idempotent && isRetryableStatus(res.status)) {
        lastErr = new ApiError(`サーバーエラーが発生しました（HTTP ${res.status}）`, res.status, true);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ApiError) || !err.retryable || !retry || !idempotent) break;
    }
  }
  if (!lastErr) lastErr = new Error('リクエストに失敗しました');
  if (lastErr instanceof Error && lastErr.name && lastErr.name === 'ApiError') {
    throw lastErr;
  }
  throw lastErr;
}

function describeError(j: any, status: number): string {
  if (!j) return `サーバーエラーが発生しました（HTTP ${status}）`;
  if (typeof j.detail === 'string') return j.detail;
  if (Array.isArray(j.detail) && typeof j.detail[0]?.msg === 'string') return j.detail[0].msg;
  if (typeof j.message === 'string') return j.message;
  return `サーバーエラーが発生しました（HTTP ${status}）`;
}

function extractErrorCode(j: any): string | null {
  if (j && typeof j.code === 'string' && j.code) return j.code;
  return null;
}

async function handle(res: Response) {
  if (res.status === 401) {
    // A credential rejection (login / expired-token) carries a specific code
    // and message; surface it (e.g. "ユーザー名またはパスワードが正しくありません")
    // instead of the generic session-expired text used for plain timeouts.
    let j: any = null;
    try {
      j = await res.json();
    } catch {
      // non-JSON body -> fall through to the generic UnauthorizedError
    }
    const code = extractErrorCode(j);
    if (code && j && typeof j.detail === 'string') {
      throw new ApiError(j.detail, 401, false, code);
    }
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    let msg = `サーバーエラーが発生しました（HTTP ${res.status}）`;
    let code: string | null = null;
    try {
      const j = await res.json();
      msg = describeError(j, res.status);
      code = extractErrorCode(j);
    } catch {
      if (res.statusText) msg = res.statusText;
    }
    throw new ApiError(msg, res.status, isRetryableStatus(res.status), code);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      // A 200 response that claims JSON but is not parseable is treated as a
      // server fault; returning a number/string here would crash downstream
      // rendering with a confusing error, so surface it as a proper failure.
      throw new ApiError('サーバーの応答を解析できませんでした', res.status, isRetryableStatus(res.status));
    }
  }
  // Success with a non-JSON body (e.g. HTML from a proxy, "OK" plain text)
  // is not an API result. Reject instead of leaking a raw string to callers.
  throw new ApiError(`サーバーから予期しない応答形式が返されました（HTTP ${res.status}）`, res.status, isRetryableStatus(res.status));
}

function get(url: string, opts?: { timeoutMs?: number; retry?: boolean }): Promise<Response> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return fetchRetry(url, { headers }, opts);
}

function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: any },
  opts?: { timeoutMs?: number; retry?: boolean }
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (authToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  let body = init.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }
  return fetchRetry(url, { method: init.method || 'GET', headers, body }, { ...opts, retry: opts?.retry ?? false });
}

export const api = {
  // ---- auth ----
  async register(payload: { username: string; password: string; display_name?: string; farm_name?: string; farm_area?: string; farm_trees?: number; farm_variety?: string; farm_location?: string; farm_contact?: string }): Promise<AuthState> {
    return handle(await send('/api/auth/register', { method: 'POST', body: payload }));
  },
  async login(username: string, password: string): Promise<AuthState> {
    return handle(await send('/api/auth/login', { method: 'POST', body: { username, password } }));
  },
  async me(): Promise<AuthUser> {
    return handle(await get('/api/auth/me'));
  },
  async updateProfile(payload: {
    display_name?: string;
    farm_name?: string;
    farm_area?: string | null;
    farm_trees?: number | null;
    farm_variety?: string | null;
    farm_location?: string | null;
    farm_contact?: string | null;
    password?: string;
    preferences?: Record<string, any>;
  }): Promise<AuthUser> {
    return handle(await send('/api/auth/profile', { method: 'PUT', body: payload }));
  },
  async getPreferences(): Promise<Record<string, any>> {
    return handle(await get('/api/auth/preferences'));
  },
  async updatePreferences(payload: Record<string, any>): Promise<Record<string, any>> {
    return handle(await send('/api/auth/preferences', { method: 'PUT', body: payload }));
  },
  async calendar(year?: number, month?: number, farmerId?: number): Promise<CalendarData> {
    const q = new URLSearchParams();
    if (year) q.set('year', String(year));
    if (month) q.set('month', String(month));
    if (farmerId != null) q.set('farmer_id', String(farmerId));
    const qs = q.toString();
    return handle(await get(`/api/calendar/observations${qs ? '?' + qs : ''}`));
  },
  async logout(): Promise<any> {
    try {
      return await handle(await send('/api/auth/logout', { method: 'POST' }));
    } finally {
      setAuthToken(null);
    }
  },
  // ---- notifications ----
  async notifications(): Promise<Notification[]> {
    return handle(await get('/api/notifications'));
  },
  async unreadCount(): Promise<{ count: number }> {
    return handle(await get('/api/notifications/unread-count'));
  },
  async markNotificationRead(id: number): Promise<any> {
    return handle(await send(`/api/notifications/${id}/read`, { method: 'POST' }));
  },
  async createNotification(payload: { title: string; body: string; target_role?: string; target_user_id?: number | null }): Promise<any> {
    return handle(await send('/api/notifications', { method: 'POST', body: payload }));
  },
  async deleteNotification(id: number): Promise<any> {
    return handle(await send(`/api/notifications/${id}`, { method: 'DELETE' }));
  },
  // ---- videos ----
  async upload(file: File): Promise<any> {
    const fd = new FormData();
    fd.append('file', file);
    if (file.lastModified > 0) {
      fd.append('captured_at', new Date(file.lastModified).toISOString());
    }
    return handle(await send('/api/videos', { method: 'POST', body: fd }));
  },
  async videos(status?: string): Promise<Video[]> {
    const q = status ? `?status=${status}` : '';
    return handle(await get(`/api/videos${q}`));
  },
  async videoJobs(): Promise<any[]> {
    return handle(await get('/api/videos/jobs'));
  },
  async analyseTimes(videoId: number, times: number[], soilMoisture?: SoilMoistureInput, treeId?: string, droneMode?: boolean, upscale?: boolean): Promise<any> {
    const body: any = { times };
    if (soilMoisture) body.soil_moisture = soilMoisture;
    if (treeId) body.tree_id = treeId;
    if (droneMode) body.drone_mode = true;
    if (upscale) body.upscale = true;
    return handle(await send(`/api/videos/${videoId}/analyse`, { method: 'POST', body }));
  },
  async observations(videoId?: number, farmerId?: number, opts?: { from_date?: string; to_date?: string; source_type?: string; tree_id?: string; limit?: number }): Promise<Observation[]> {
    let url: string;
    if (videoId != null) {
      url = `/api/videos/${videoId}/observations`;
    } else {
      const q = new URLSearchParams();
      if (farmerId != null) q.set('farmer_id', String(farmerId));
      if (opts?.from_date) q.set('from_date', opts.from_date);
      if (opts?.to_date) q.set('to_date', opts.to_date);
      if (opts?.source_type) q.set('source_type', opts.source_type);
      if (opts?.tree_id) q.set('tree_id', opts.tree_id);
      if (opts?.limit != null) q.set('limit', String(opts.limit));
      const qs = q.toString();
      url = `/api/observations${qs ? '?' + qs : ''}`;
    }
    return handle(await get(url));
  },
  async listTrees(): Promise<TreeRecord[]> {
    return handle(await get('/api/trees'));
  },
  async listFarmTrees(farmerId?: number): Promise<TreeRegistryData> {
    const q = new URLSearchParams();
    if (farmerId != null) q.set('farmer_id', String(farmerId));
    const qs = q.toString();
    return handle(await get(`/api/trees/registry${qs ? '?' + qs : ''}`));
  },
  async createFarmTree(payload: { tree_id: string; name?: string; variety?: string; row_num: number; col_num: number; note?: string }, farmerId?: number): Promise<FarmTreeRecord> {
    const q = farmerId != null ? `?farmer_id=${farmerId}` : '';
    return handle(await send(`/api/trees/registry${q}`, { method: 'POST', body: payload }));
  },
  async updateFarmTree(treeId: string, payload: { name?: string; variety?: string; row_num?: number; col_num?: number; note?: string }, farmerId?: number): Promise<FarmTreeRecord> {
    const q = farmerId != null ? `?farmer_id=${farmerId}` : '';
    return handle(await send(`/api/trees/registry/${encodeURIComponent(treeId)}${q}`, { method: 'PUT', body: payload }));
  },
  async deleteFarmTree(treeId: string, farmerId?: number): Promise<any> {
    const q = farmerId != null ? `?farmer_id=${farmerId}` : '';
    return handle(await send(`/api/trees/registry/${encodeURIComponent(treeId)}${q}`, { method: 'DELETE' }));
  },
  async importFarmTrees(farmerId?: number): Promise<{ imported?: string[]; count: number }> {
    const q = farmerId != null ? `?farmer_id=${farmerId}` : '';
    return handle(await send(`/api/trees/registry/import${q}`, { method: 'POST' }));
  },
  async farmMap(farmerId?: number): Promise<FarmMapData> {
    const q = new URLSearchParams();
    if (farmerId != null) q.set('farmer_id', String(farmerId));
    const qs = q.toString();
    return handle(await get(`/api/farm-map${qs ? '?' + qs : ''}`));
  },
  async deleteObservations(ids: number[]): Promise<any> {
    return handle(await send('/api/observations', { method: 'DELETE', body: { ids } }));
  },
  async exportObservations(opts?: { from_date?: string; to_date?: string; source_type?: string; farmer_id?: number; tree_id?: string }): Promise<void> {
    const q = new URLSearchParams();
    if (opts?.from_date) q.set('from_date', opts.from_date);
    if (opts?.to_date) q.set('to_date', opts.to_date);
    if (opts?.source_type) q.set('source_type', opts.source_type);
    if (opts?.farmer_id != null) q.set('farmer_id', String(opts.farmer_id));
    if (opts?.tree_id) q.set('tree_id', opts.tree_id);
    const qs = q.toString();
    const url = `/api/observations/export${qs ? '?' + qs : ''}`;
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetchRetry(url, { headers }, { timeoutMs: 90_000 });
    if (!res.ok) {
      let msg = `サーバーエラーが発生しました（HTTP ${res.status}）`;
      try { msg = describeError(await res.json(), res.status); } catch {}
      throw new ApiError(msg, res.status, isRetryableStatus(res.status));
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = `observations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },
  async oliveStatus(farmerId?: number): Promise<OliveStatus> {
    const q = farmerId != null ? `?farmer_id=${farmerId}` : '';
    return handle(await get(`/api/olive/status${q}`));
  },
  async health(): Promise<any> {
    return handle(await get('/api/health'));
  },
  async pingHealth(timeoutMs = 8000): Promise<boolean> {
    try {
      await handle(await get('/api/health', { timeoutMs, retry: false }));
      return true;
    } catch {
      return false;
    }
  },
  async versions(): Promise<VersionInfo> {
    return handle(await get('/api/versions'));
  },
  // ---- images ----
  async uploadImage(file: File): Promise<ImageAsset> {
    const fd = new FormData();
    fd.append('file', file);
    if (file.lastModified > 0) {
      fd.append('captured_at', new Date(file.lastModified).toISOString());
    }
    return handle(await send('/api/images', { method: 'POST', body: fd }));
  },
  async images(): Promise<ImageAsset[]> {
    return handle(await get('/api/images'));
  },
  async analyseImage(imageId: number, soilMoisture?: SoilMoistureInput, treeId?: string, droneMode?: boolean, upscale?: boolean): Promise<any> {
    const body: any = {};
    if (soilMoisture) body.soil_moisture = soilMoisture;
    if (treeId) body.tree_id = treeId;
    if (droneMode) body.drone_mode = true;
    if (upscale) body.upscale = true;
    return handle(await send(`/api/images/${imageId}/analyse`, { method: 'POST', body }));
  },
  async imageObservations(imageId: number): Promise<Observation[]> {
    return handle(await get(`/api/images/${imageId}/observations`));
  },
  // ---- delete own data (farmer-scoped) ----
  async deleteOwnVideo(id: number): Promise<any> {
    return handle(await send(`/api/videos/${id}`, { method: 'DELETE' }));
  },
  async deleteOwnImage(id: number): Promise<any> {
    return handle(await send(`/api/images/${id}`, { method: 'DELETE' }));
  },
  async deleteOwnObservation(id: number): Promise<any> {
    return handle(await send(`/api/observations/${id}`, { method: 'DELETE' }));
  },
  // ---- soil ----
  async soilStatus(): Promise<SoilStatus> {
    return handle(await get('/api/soil-moisture/status'));
  },
  // ---- sensor alerting ----
  async sensorAlerts(): Promise<SensorAlertsStatus> {
    return handle(await get('/api/sensor-alerts'));
  },
  async testSensorNotification(): Promise<NotificationTestResult> {
    return handle(await send('/api/admin/soil-config/test-notification', { method: 'POST' }));
  },
  async previewTemplate(payload: {
    template: Record<string, string> | string;
    sample?: string;
    webhook_format?: string;
  }): Promise<TemplatePreviewResult> {
    return handle(await send('/api/admin/soil-config/template-preview', { method: 'POST', body: payload }));
  },
  // ---- admin ----
  async adminStats(): Promise<AdminStats> {
    return handle(await get('/api/admin/stats'));
  },
  async adminOverview(): Promise<AdminOverview> {
    return handle(await get('/api/admin/overview'));
  },
  async getSettings(): Promise<{ health_thresholds: HealthThresholds }> {
    return handle(await get('/api/admin/settings'));
  },
  async saveSettings(payload: { health_thresholds?: HealthThresholds; site?: Partial<SiteSettings> }): Promise<any> {
    return handle(await send('/api/admin/settings', { method: 'PUT', body: payload }));
  },
  async siteSettings(): Promise<{ site: Partial<SiteSettings> }> {
    return handle(await get('/api/settings'));
  },
  async testSoil(): Promise<SoilStatus> {
    return handle(await send('/api/admin/soil-config/test', { method: 'POST' }));
  },
  async saveSoilConfig(payload: Record<string, any>): Promise<any> {
    return handle(await send('/api/admin/soil-config', { method: 'PUT', body: payload }));
  },
  async deleteVideo(id: number): Promise<any> {
    return handle(await send(`/api/admin/videos/${id}`, { method: 'DELETE' }));
  },
  async deleteImage(id: number): Promise<any> {
    return handle(await send(`/api/admin/images/${id}`, { method: 'DELETE' }));
  },
  async deleteObservation(id: number): Promise<any> {
    return handle(await send(`/api/admin/observations/${id}`, { method: 'DELETE' }));
  },
  async clearObservations(): Promise<any> {
    return handle(await send('/api/admin/observations/clear', { method: 'POST' }));
  },
  // ---- farmer management (admin) ----
  async listFarmers(): Promise<FarmerRecord[]> {
    return handle(await get('/api/admin/farmers'));
  },
  async updateFarmer(id: number, payload: { display_name?: string; farm_name?: string; farm_area?: string; farm_trees?: number; farm_variety?: string; farm_location?: string; farm_contact?: string; is_active?: boolean }): Promise<AuthUser> {
    return handle(await send(`/api/admin/farmers/${id}`, { method: 'PUT', body: payload }));
  },
  async resetFarmerPassword(id: number, new_password: string): Promise<any> {
    return handle(await send(`/api/admin/farmers/${id}/password`, { method: 'PUT', body: { new_password } }));
  },
  async deleteFarmer(id: number): Promise<any> {
    return handle(await send(`/api/admin/farmers/${id}`, { method: 'DELETE' }));
  },
};

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(ss)}`;
}
