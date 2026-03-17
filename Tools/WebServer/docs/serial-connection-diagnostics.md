# 串口连接自检机制整改方案

## 现状分析

### 当前连接流程

1. 前端 `refreshPorts()` → `GET /api/ports` → `scan_serial_ports()` 扫描可用端口
2. 用户选择端口和波特率，点击连接
3. 前端 `toggleConnect()` → `POST /api/connect` → `serial_open()` 打开串口
4. 失败时最多重试 10 次（每次间隔 1s），全部失败后弹 alert

### 已发现的问题

#### 1. 错误信息丢失（BUG）

后端返回 `{"success": false, "error": "Serial error: ..."}` ，但前端读取的是 `data.message`：

```javascript
// connection.js line ~198
lastError = new Error(data.message || 'Connection failed');
```

`data.message` 始终为 `undefined`，用户永远只看到 "Connection failed"，真正的错误原因被吞掉了。

#### 2. 无意义的重试

所有连接失败都会重试 10 次。但对于权限不足、设备不存在等确定性错误，重试毫无意义，只会让用户等待 10 秒才看到结果。

#### 3. 错误信息不可操作

`serial.SerialException` 的原始异常信息对普通用户不友好，例如：
- `[Errno 13] could not open port /dev/ttyACM0: [Errno 13] Permission denied: '/dev/ttyACM0'`
- `[Errno 2] could not open port /dev/ttyACM0: [Errno 2] No such file or directory: '/dev/ttyACM0'`

用户看到这些信息后不知道该怎么做。

#### 4. 端口扫描缺少诊断信息

`scan_serial_ports()` 只返回 `device` 和 `description`，不包含：
- 端口是否有读写权限
- 端口是否被其他进程占用
- 设备的 VID/PID（帮助识别设备类型）

#### 5. 波特率错误无法检测

连接成功（串口打开成功）但波特率不匹配时，不会报错。用户会看到"已连接"但设备无响应，不知道是波特率问题还是设备问题。

#### 6. 连接成功后无设备验证

连接成功后调用了 `fpbInfo()` 获取设备信息，但如果设备无响应（波特率错误、设备未运行 FPBInject 固件等），没有明确的反馈告诉用户问题所在。

---

## 整改方案

### Phase 1: 修复基础问题

#### 1.1 修复错误字段名不匹配

**文件**: `static/js/core/connection.js`

```javascript
// 修复前
lastError = new Error(data.message || 'Connection failed');

// 修复后
lastError = new Error(data.error || 'Connection failed');
```

#### 1.2 后端错误分类

**文件**: `utils/serial.py`

在 `serial_open()` 中对异常进行分类，返回结构化错误：

```python
def serial_open(port, baudrate=115200, ...):
    try:
        ser = serial.Serial(...)
        ...
    except serial.SerialException as e:
        error_str = str(e)
        # 分类错误，附带 error_code
        if "Permission denied" in error_str or "Errno 13" in error_str:
            return None, "permission_denied", f"Serial error: {e}"
        elif "No such file" in error_str or "Errno 2" in error_str:
            return None, "device_not_found", f"Serial error: {e}"
        elif "Device or resource busy" in error_str or "Errno 16" in error_str:
            return None, "device_busy", f"Serial error: {e}"
        else:
            return None, "serial_error", f"Serial error: {e}"
    except Exception as e:
        return None, "unknown_error", f"Error: {e}"
```

#### 1.3 后端返回结构化错误

**文件**: `app/routes/connection.py`

```python
# api_connect 返回增加 error_code 字段
if result["error_code"]:
    return jsonify({
        "success": False,
        "error": result["error"],
        "error_code": result["error_code"],
    })
```

#### 1.4 前端根据 error_code 跳过重试

**文件**: `static/js/core/connection.js`

对确定性错误（权限、设备不存在）立即停止重试：

```javascript
const NON_RETRYABLE = ['permission_denied', 'device_not_found', 'device_busy'];

if (data.error_code && NON_RETRYABLE.includes(data.error_code)) {
    lastError = { code: data.error_code, message: data.error };
    break; // 不再重试
}
```

### Phase 2: 增强端口扫描诊断

#### 2.1 端口扫描增加权限和占用检测

**文件**: `utils/serial.py` — `scan_serial_ports()`

```python
def scan_serial_ports():
    ports = serial.tools.list_ports.comports()
    result = []
    for port in ports:
        if port.device.startswith("/dev/ttyS"):
            continue
        info = {
            "device": port.device,
            "description": port.description,
            "vid": port.vid,
            "pid": port.pid,
            "accessible": os.access(port.device, os.R_OK | os.W_OK),
        }
        result.append(info)
    return result
```

#### 2.2 前端端口列表标记不可用端口

**文件**: `static/js/core/connection.js` — `refreshPorts()`

在端口下拉列表中标记无权限的端口（如 `🔒 /dev/ttyACM0`），选择时弹出提示。

### Phase 3: 用户友好的错误提示

#### 3.1 前端 alert 内容改为可操作的诊断建议

**文件**: `static/js/core/connection.js`

根据 `error_code` 显示不同的 alert 内容：

| error_code | alert 内容 |
|---|---|
| `permission_denied` | 串口权限不足。\n请运行: `sudo usermod -aG dialout $USER` 然后重新登录。 |
| `device_not_found` | 设备未找到。\n请检查 USB 线缆是否连接，或尝试刷新端口列表。 |
| `device_busy` | 串口被其他程序占用。\n请关闭其他串口工具（如 minicom、screen、PuTTY）后重试。 |
| `serial_error` | 串口通信错误。\n请检查串口线缆和设备状态。 |

这些提示文本需要加入 i18n 三语言文件（zh-CN / en / zh-TW）。

#### 3.2 i18n key 规划

```
messages.diag_permission_denied
messages.diag_permission_denied_hint
messages.diag_device_not_found
messages.diag_device_not_found_hint
messages.diag_device_busy
messages.diag_device_busy_hint
messages.diag_serial_error
messages.diag_serial_error_hint
messages.diag_device_no_response
messages.diag_device_no_response_hint
```

### Phase 4: 连接后设备验证

#### 4.1 连接成功后自动 echo 检测

**文件**: `app/routes/connection.py` — `api_connect()`

串口打开成功后，发送一次 `echo` 命令验证设备是否响应：

```python
# 串口打开成功后
ser.write(b"\necho ping\n")
time.sleep(0.3)
response = ser.read(ser.in_waiting)
if b"ping" not in response:
    # 串口打开成功但设备无响应
    return jsonify({
        "success": True,
        "port": port,
        "warning": "device_no_response",
        "warning_message": "Port opened but device is not responding. Check baudrate or device firmware.",
    })
```

#### 4.2 前端处理 warning

连接成功但有 warning 时，显示非阻塞提示（alert）：

```javascript
if (data.success) {
    handleConnected(port);
    if (data.warning === 'device_no_response') {
        alert(t('messages.diag_device_no_response') + '\n\n' +
              t('messages.diag_device_no_response_hint'));
    }
}
```

---

## 改动文件清单

| 文件 | 改动内容 |
|---|---|
| `utils/serial.py` | `serial_open()` 返回 error_code；`scan_serial_ports()` 增加 accessible 字段 |
| `app/routes/connection.py` | `api_connect()` 返回 error_code；连接后 echo 验证 |
| `static/js/core/connection.js` | 修复 `data.message` → `data.error`；error_code 跳过重试；诊断 alert |
| `static/js/locales/zh-CN.js` | 新增诊断提示 i18n |
| `static/js/locales/en.js` | 新增诊断提示 i18n |
| `static/js/locales/zh-TW.js` | 新增诊断提示 i18n |
| `tests/` | 对应的单元测试更新 |

## 优先级

1. **P0** — Phase 1（修复错误信息丢失 + 错误分类 + 跳过无意义重试）
2. **P1** — Phase 3（用户友好的诊断 alert）
3. **P2** — Phase 2（端口扫描增强）
4. **P2** — Phase 4（连接后设备验证）
