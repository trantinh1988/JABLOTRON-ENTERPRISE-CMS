/** Nhãn tiếng Việt dùng chung trên UI */

export const vi = {
  brandSubtitle: 'USB trực tiếp · Bản quyền offline',
  brandTitle: 'Jablotron',
  brandAccent: 'Enterprise CMS',

  navDashboard: 'Điều khiển',
  navDevices: 'Khai báo thiết bị',
  navStatus: 'Trạng thái',
  navMaps: 'Bản đồ',
  navHistory: 'Lịch sử',
  navSettings: 'Bản quyền',

  wsLive: 'WS trực tuyến',
  wsDown: 'WS mất kết nối',
  licenseFull: 'Bản quyền đầy đủ',
  licenseReadOnly: 'Chỉ đọc',
  usbMock: 'USB mô phỏng',
  usbHid: 'USB HID thật',

  licenseTitle: 'Bản quyền offline',
  status: 'Trạng thái',
  mode: 'Chế độ',
  hwid: 'Mã máy (HWID)',
  expires: 'Hết hạn',
  exportReq: 'Xuất file .req',
  importLic: 'Nhập file .lic',
  exportOk: 'Đã tải file .req — gửi Admin để ký.',
  licenseActiveUntil: (date: string) => `Bản quyền đã kích hoạt đến ${date}`,

  panelTitle: 'Điều khiển đa tủ',
  selectAll: 'Chọn tất cả',
  readOnlyHint: 'Chế độ chỉ đọc — cần bản quyền hợp lệ để thao tác ghi.',
  noPanels: 'Chưa phát hiện tủ nào.',
  pickPanel: 'Chọn ít nhất một tủ.',
  arm: 'Bật bảo vệ',
  disarm: 'Tắt bảo vệ',
  partial: 'Bảo vệ một phần',
  queued: (action: string, n: number) => `Đã xếp lệnh ${action} cho ${n} tủ.`,
  devices: 'thiết bị',

  mapTitle: 'Bản đồ 2D thiết bị',
  allPanels: 'Tất cả tủ',
  sensors: 'cảm biến',
  panels: 'tủ',
  alarm: 'báo động',
  open: 'mở',
  legendOk: 'Bình thường',
  legendOpen: 'Mở',
  legendAlarm: 'Báo động',
  floorLabel: 'MẶT BẰNG',
  floorAria: 'Bản đồ mặt bằng',
  filterMap: 'Lọc bản đồ:',

  eventsTitle: 'Sự kiện trực tiếp',
  eventsWaiting: 'Đang chờ sự kiện từ máy chủ…',

  devicesPageTitle: 'Khai báo thiết bị',
  devicesPageHint:
    'Khai báo tủ trung tâm, rồi đăng ký địa chỉ cảm biến Jablotron (nên thêm một lần theo dải, vd. 1→80).',
  addDevice: 'Thêm thiết bị',
  addPanel: 'Thêm tủ',
  editDevice: 'Sửa thiết bị',
  editPanel: 'Sửa tủ',
  deleteDevice: 'Xóa',
  deletePanel: 'Xóa tủ',
  deleteSelected: 'Xóa đã chọn',
  selectedCount: (n: number) => `Đã chọn ${n}`,
  save: 'Lưu',
  cancel: 'Hủy',
  label: 'Nhãn',
  labelPrefix: 'Tiền tố nhãn',
  deviceType: 'Loại',
  deviceNum: 'Số thiết bị (0–99)',
  deviceFrom: 'Từ địa chỉ',
  deviceTo: 'Đến địa chỉ',
  bulkMode: 'Khai báo hàng loạt (dải địa chỉ)',
  singleMode: 'Một thiết bị',
  panelIndex: 'Số tủ',
  panelName: 'Tên tủ',
  panel: 'Tủ',
  panelsSection: 'Tủ trung tâm',
  devicesSection: 'Thiết bị / địa chỉ',
  noDevices: 'Chưa có thiết bị nào.',
  noPanelsHint: 'Chưa có tủ. Hãy thêm tủ trung tâm hoặc kết nối USB.',
  bulkResult: (created: number, skipped: number) =>
    `Đã thêm ${created} thiết bị` + (skipped ? `, bỏ qua ${skipped} đã tồn tại` : '') + '.',
  deleteResult: (n: number) => `Đã xóa ${n} thiết bị.`,
  confirmDeleteDevice: (id: string) => `Xóa thiết bị ${id}?`,
  confirmDeleteDevices: (n: number) => `Xóa ${n} thiết bị đã chọn?`,
  confirmDeletePanel: (name: string, n: number) =>
    `Xóa tủ "${name}" và ${n} thiết bị thuộc tủ?`,
  panelDeclared: 'Đã khai báo tủ trung tâm.',
  panelUpdated: 'Đã cập nhật tủ.',
  panelDeleted: 'Đã xóa tủ trung tâm.',
  panelSetup: 'Thiết lập tủ',
  backToDevices: 'Quay lại khai báo',
  tabOverview: 'Tổng quan',
  tabZones: 'Phân vùng',
  tabUsers: 'User',
  tabInputs: 'Device Input',
  tabPg: 'PG Output',
  tabConnection: 'Kết nối',
  zoneName: 'Tên vùng',
  sectionNum: 'Số section',
  addZone: 'Thêm vùng',
  editZone: 'Sửa vùng',
  noZones: 'Chưa có vùng nào.',
  confirmDeleteZone: (name: string) => `Xóa vùng "${name}"? Địa chỉ thuộc vùng sẽ được gỡ gán.`,
  assignZone: 'Gán vùng',
  unassignZone: 'Không thuộc vùng',
  zoneAddresses: 'Địa chỉ thuộc vùng',
  addUser: 'Thêm user',
  editUser: 'Sửa user',
  userName: 'Tên user',
  codeLabel: 'Mã / nhãn mã',
  permissions: 'Quyền',
  noUsers: 'Chưa có user nào.',
  confirmDeleteUser: (name: string) => `Xóa user "${name}"?`,
  addPg: 'Thêm PG',
  editPg: 'Sửa PG',
  pgNum: 'Số PG (1–128)',
  pgMode: 'Chế độ',
  pgState: 'Trạng thái PG',
  noPgs: 'Chưa có PG nào.',
  confirmDeletePg: (label: string) => `Xóa PG "${label}"?`,
  connectionStatus: 'Trạng thái kết nối',
  usbPath: 'Đường dẫn USB',
  lastSeen: 'Lần cuối online',
  connectionHintMock: 'Tủ đang chạy ở chế độ mô phỏng (CMS_USB_MOCK_MODE=true). Trạng thái cảm biến được sinh ngẫu nhiên.',
  connectionHintUsb: 'Tủ đã kết nối qua USB HID. Trạng thái cập nhật tự động từ tủ thật.',
  connectionHintDisconnected: 'Tủ chưa kết nối USB. Cắm cáp Link Jablotron hoặc bật chế độ mô phỏng để thử nghiệm.',
  summaryZones: 'Số vùng',
  summaryUsers: 'Số user',
  summaryInputs: 'Số địa chỉ',
  summaryPgs: 'Số PG',
  panelNotFound: 'Không tìm thấy tủ.',

  statusPageTitle: 'Trạng thái theo danh sách',
  statusPageHint: 'Theo dõi realtime trạng thái tủ và cảm biến.',
  filterPanel: 'Lọc tủ',
  filterState: 'Lọc trạng thái',
  allStates: 'Tất cả trạng thái',
  search: 'Tìm kiếm…',
  refresh: 'Làm mới',

  mapsPageTitle: 'Bản đồ mặt bằng',
  mapsPageHint: 'Thêm / sửa / xóa bản đồ và đặt vị trí thiết bị.',
  addMap: 'Thêm bản đồ',
  editMap: 'Sửa bản đồ',
  deleteMap: 'Xóa bản đồ',
  mapName: 'Tên bản đồ',
  mapDescription: 'Mô tả',
  placeDevice: 'Gắn thiết bị',
  unplaceDevice: 'Gỡ khỏi bản đồ',
  clickToPlace: 'Chọn thiết bị rồi click lên bản đồ để đặt vị trí.',
  noMaps: 'Chưa có bản đồ. Hãy tạo bản đồ mới.',
  confirmDeleteMap: (name: string) => `Xóa bản đồ "${name}" và gỡ tất cả thiết bị trên đó?`,
  backgroundUrl: 'URL ảnh nền (tuỳ chọn)',

  historyPageTitle: 'Lịch sử sự kiện',
  historyPageHint: 'Chuỗi audit trail từ tủ và thiết bị.',
  loadMore: 'Tải thêm',
  noHistory: 'Chưa có sự kiện lưu trữ.',
  filterType: 'Loại sự kiện',
  allTypes: 'Tất cả loại',

  backendError: (msg: string) => `Không kết nối được máy chủ: ${msg}`,
  failed: 'thất bại',
  success: 'Thành công',
} as const

export const licenseStatusLabel: Record<string, string> = {
  missing: 'Chưa có bản quyền',
  active: 'Đang hiệu lực',
  expired: 'Hết hạn',
  invalid_signature: 'Chữ ký không hợp lệ',
  hwid_mismatch: 'Không khớp mã máy',
  app_mismatch: 'Không khớp mã ứng dụng',
  malformed: 'File không hợp lệ',
}

export const licenseModeLabel: Record<string, string> = {
  full: 'Đầy đủ',
  'read-only': 'Chỉ đọc',
}

export const armedStateLabel: Record<string, string> = {
  armed: 'Đã bật bảo vệ',
  disarmed: 'Đã tắt bảo vệ',
  partial: 'Bảo vệ một phần',
}

export const connectionLabel: Record<string, string> = {
  mock: 'Mô phỏng',
  usb: 'USB đã kết nối',
  disconnected: 'Chưa kết nối',
}

export const deviceStateLabel: Record<string, string> = {
  ok: 'Bình thường',
  open: 'Mở',
  alarm: 'Báo động',
}

export const deviceTypeLabel: Record<string, string> = {
  sensor: 'Cảm biến',
  pir: 'Hồng ngoại (PIR)',
  door: 'Cửa / từ',
  smoke: 'Khói',
  glass: 'Vỡ kính',
  siren: 'Còi',
  keypad: 'Bàn phím',
  other: 'Khác',
}

export const pgModeLabel: Record<string, string> = {
  pulse: 'Xung',
  latched: 'Giữ',
  timed: 'Hẹn giờ',
}

export const pgStateLabel: Record<string, string> = {
  on: 'Bật',
  off: 'Tắt',
}

export const permissionLabel: Record<string, string> = {
  arm: 'Bật bảo vệ',
  disarm: 'Tắt bảo vệ',
  partial: 'Bảo vệ một phần',
  pg_control: 'Điều khiển PG',
  bypass: 'Bypass',
  admin: 'Quản trị',
}

export const eventTypeLabel: Record<string, string> = {
  connected: 'Đã kết nối',
  device_state: 'Trạng thái thiết bị',
  panel_armed: 'Trạng thái bảo vệ tủ',
  command_error: 'Lỗi lệnh',
  panel_connected: 'Tủ đã kết nối',
  panel_disconnected: 'Tủ mất kết nối',
  usb_error: 'Lỗi USB',
  device_declared: 'Khai báo thiết bị',
  device_updated: 'Cập nhật thiết bị',
  device_deleted: 'Xóa thiết bị',
  panel_declared: 'Khai báo tủ trung tâm',
  panel_updated: 'Cập nhật tủ',
  panel_deleted: 'Xóa tủ trung tâm',
}

export const actionLabel: Record<string, string> = {
  arm: 'Bật bảo vệ',
  disarm: 'Tắt bảo vệ',
  partial: 'Bảo vệ một phần',
}

export function labelOf(map: Record<string, string>, key: string | null | undefined, fallback?: string) {
  if (!key) return fallback ?? '—'
  return map[key] ?? fallback ?? key
}
