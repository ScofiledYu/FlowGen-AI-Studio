/**
 * Kling Video API 测试脚本
 * 根据 Python 测试代码 (kling_video_test.py) 实现
 * 
 * 使用方法：
 * 1. 确保已安装依赖: npm install
 * 2. 准备两张测试图片（首帧图和尾帧图）
 * 3. 修改下面的图片路径
 * 4. 运行: npx tsx test-kling-video.ts
 */

import { createKlingVideoTask, uploadImage, getTaskStatus } from './services/aitop.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES Module 兼容性处理
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Node.js 18+ 内置了 FormData 和 Blob，无需额外导入

// 配置测试参数 - 请修改为您的实际图片路径
const START_IMAGE_PATH = 'D:/01.jpg';  // 首帧图
const END_IMAGE_PATH = 'D:/02.jpg';    // 尾帧图

/**
 * 将本地图片转换为 base64 编码
 */
function imageToBase64(filePath: string): string | null {
  
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    
    // 检测图片格式
    const ext = path.extname(filePath).toLowerCase();
    let mimeType: string;
    
    if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg';
    } else if (ext === '.png') {
      mimeType = 'image/png';
    } else {
      return null;
    }
    
    const base64Str = `data:${mimeType};base64,${base64Data}`;
    return base64Str;
  } catch (error) {
    return null;
  }
}

/**
 * 直接上传文件到服务器
 */
async function uploadFileDirect(filePath: string): Promise<string | null> {
  
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    
    // 创建 Blob
    const blob = new Blob([fileBuffer]);
    const fileName = path.basename(filePath);
    formData.append('file', blob, fileName);
    
    const API_KEY = "aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma";
    const BASE_URL = "https://aitop100-api.hytch.com";
    const FILE_PREFIX = "https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/";
    
    const response = await fetch(`${BASE_URL}/api/v1/file/upload`, {
      method: 'POST',
      headers: {
        'api-key': API_KEY
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (data.code === 0 && data.success) {
      const fileKey = data.data?.key;
      if (fileKey) {
        const fullUrl = FILE_PREFIX + fileKey;
        return fullUrl;
      } else {
      }
    } else {
    }
  } catch (error) {
  }
  
  return null;
}

/**
 * 上传文件到服务器（优先使用上传接口，失败则使用 base64）
 */
async function uploadFile(filePath: string): Promise<string | null> {
  // 方式1: 尝试直接文件上传（优先使用）
  const uploadedUrl = await uploadFileDirect(filePath);
  if (uploadedUrl) {
    return uploadedUrl;
  }
  
  // 方式2: 使用 base64 编码作为备选
  return imageToBase64(filePath);
}

/**
 * 轮询任务状态
 * 参考 Python 代码实现
 */
async function pollTaskStatus(taskId: string): Promise<string | null> {
  
  while (true) {
    try {
      const statusData = await getTaskStatus(taskId);
      
      // 如果查询接口返回错误，退出循环
      if (!statusData) {
        break;
      }
      
      const status = statusData.status;
      
      // 只在 TRANSFER_SUCCESS 状态时获取 URL
      if (status === 'TRANSFER_SUCCESS') {
        const resourceUrl = statusData.resourceUrl;
        if (resourceUrl) {
          return resourceUrl;
        } else {
          return null;
        }
      }
      
      // SUCCESS 状态时继续轮询，等待 TRANSFER_SUCCESS
      if (status === 'SUCCESS' || status === '2' || status === '5') {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒轮询一次
        continue;
      }
      
      // 失败状态：["3", "FAIL", "6", "TRANSFER_FAIL"]
      if (status === '3' || status === 'FAIL' || status === '6' || status === 'TRANSFER_FAIL') {
        const errorMsg = statusData.errorDescription || statusData.errorMsg || '未知错误';
        return null;
      }
      
      // 其他状态：继续轮询，打印当前状态（不换行，动态更新）
      await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒轮询一次
      
    } catch (error) {
      break;
    }
  }
  
  return null;
}

/**
 * 主测试函数
 */
async function main() {
  
  // 验证图片文件是否存在
  if (!fs.existsSync(START_IMAGE_PATH)) {
    process.exit(1);
  }
  
  if (!fs.existsSync(END_IMAGE_PATH)) {
    process.exit(1);
  }
  
  // 上传图片
  const startImage = await uploadFile(START_IMAGE_PATH);
  
  const endImage = await uploadFile(END_IMAGE_PATH);
  
  // 验证图片上传是否成功
  if (!startImage || !endImage) {
    process.exit(1);
  }
  
  
  // 视频生成参数
  const prompt = '一个美丽的风景视频，展示从山脚下到山顶的变化过程';
  
  // 创建视频生成任务
  const taskId = await createKlingVideoTask({
    prompt: prompt,
    image: startImage,
    imageTail: endImage,
    mode: 'pro',
    duration: '10',
    cfgScale: 0.7,
    sound: 'off',
    generateNum: 1
  });
  
  if (taskId) {
    // 轮询任务状态
    const videoUrl = await pollTaskStatus(taskId);
    
    if (videoUrl) {
    } else {
    }
  } else {
  }
  
}

// 运行测试
main().catch(error => {
  process.exit(1);
});

