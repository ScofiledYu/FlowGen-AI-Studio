import requests
import base64
import os

# -------------------------- 配置项（根据实际情况修改） --------------------------
API_URL = "https://models.fangte.com/v1/chat/completions"  # 修正：移除多余空格和反引号
API_KEY = "0fd502c3-7d1b-43d3-9eb6-4e91918af979"  # 你的 API Key
MODEL_NAME = "Qwen3-VL-235B-A22B-Instruct"  # 模型名称
IMAGE_PATH = "D:/d439b6003af33a87fcab0640564495285243b54a.jpg"  # 本地图片路径（JPG格式）
MAX_TOKENS = 204800  # 最大生成令牌数
PROMPT_TEXT = "请分析这份文档的内容。"  # 提问文本
# 代理配置（根据需求选择：None 表示禁用代理，或填写实际代理地址）
PROXIES = {
    "http": None,
    "https": None
    # 若需代理，示例："http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"
}
# ------------------------------------------------------------------------------

def image_to_base64(image_path):
    """
    将本地图片转换为 Base64 编码字符串
    
    :param image_path: 图片本地路径
    :return: Base64 编码字符串
    """
    # 检查图片文件是否存在
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"图片文件不存在：{image_path}")
    # 以二进制模式读取图片并编码
    with open(image_path, "rb") as f:
        image_bytes = f.read()
        base64_str = base64.b64encode(image_bytes).decode("utf-8")  # 转字符串（JSON 不支持 bytes）
    return base64_str

def get_image_format(image_path):
    """
    获取图片格式（png/jpeg/gif 等），用于构造 Data URL
    
    :param image_path: 图片本地路径
    :return: 图片格式字符串（如 png、jpeg）
    """
    ext = os.path.splitext(image_path)[-1].lower().lstrip(".")
    # 处理常见图片格式的映射（如 jpg 对应 jpeg）
    format_map = {
        "jpg": "jpeg",
        "jpeg": "jpeg",
        "png": "png",
        "gif": "gif",  # 增加常见格式支持
        "webp": "webp"
    }
    return format_map.get(ext, "jpeg")  # 默认返回 jpeg 而不是 png，更符合常见图片格式

def call_multimodal_api():
    """调用多模态 API（文本+图片）"""
    try:
        # 1. 图片转 Base64
        image_base64 = image_to_base64(IMAGE_PATH)
        # 获取图片格式并构造 Data URL
        image_format = get_image_format(IMAGE_PATH)
        image_data_url = f"data:image/{image_format};base64,{image_base64}"

        # 2. 构造请求头
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        }

        # 3. 构造请求体
        payload = {
            "model": MODEL_NAME,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": PROMPT_TEXT
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_data_url
                            }
                        }
                    ]
                }
            ],
            "max_tokens": MAX_TOKENS
        }

        # 4. 发送 POST 请求（添加 proxies 参数禁用/配置代理）
        print(f"正在调用 API...
模型：{MODEL_NAME}
图片路径：{IMAGE_PATH}
图片格式：{image_format}")
        print(f"请求头：{headers}")
        print(f"请求体大小：约 {len(str(payload))} 字符")
        
        response = requests.post(
            url=API_URL,
            headers=headers,
            json=payload,
            proxies=PROXIES,  # 关键：添加代理配置
            timeout=600  # 超时时间（秒），多模态模型处理图片可能较慢
        )

        # 5. 处理响应
        response.raise_for_status()  # 若响应状态码不是 200，抛出 HTTP 错误异常
        result = response.json()
        # 提取返回的文本内容
        answer = result["choices"][0]["message"]["content"]
        print("\n===== 响应结果 =====")
        print(answer)

    except FileNotFoundError as e:
        print(f"错误：{e}")
    except requests.exceptions.HTTPError as e:
        # 处理 HTTP 错误（如 401 未授权、404 接口不存在、500 服务器错误等）
        print(f"HTTP 错误：{e}")
        if 'response' in locals():
            print(f"响应状态码：{response.status_code}")
            print(f"响应内容：{response.text}")
    except requests.exceptions.RequestException as e:
        # 处理网络错误（如连接超时、域名无法解析、代理错误等）
        print(f"请求错误：{e}")
    except KeyError as e:
        # 处理响应 JSON 解析错误
        print(f"响应格式错误：缺少预期的键 {e}")
        if 'response' in locals():
            print(f"响应内容：{response.text}")
    except Exception as e:
        # 处理其他未知错误
        print(f"未知错误：{e}")
        import traceback
        traceback.print_exc()  # 打印完整的错误堆栈信息

if __name__ == "__main__":
    call_multimodal_api()