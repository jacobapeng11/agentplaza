const axios = require('axios');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

async function uploadImage(file) {
  const gateway = process.env.MINIO_UPLOAD_URL?.trim();
  if (!gateway) {
    const error = new Error('部署尚未配置应用图片上传服务');
    error.statusCode = 503;
    throw error;
  }

  const extension = file.originalname.match(/\.[a-z0-9]{1,8}$/i)?.[0].toLowerCase() || '';
  const fileName = randomUUID() + extension;
  const form = new FormData();
  form.append('file', file.buffer, { filename: fileName, contentType: file.mimetype });
  form.append('bucketName', process.env.MINIO_BUCKET || 'agentplaza');
  form.append('folderName', 'link-apps/' + new Date().toISOString().slice(0, 10) + '/');
  form.append('fileName', fileName);

  try {
    const { data } = await axios.post(gateway, form, {
      headers: form.getHeaders(),
      timeout: Number(process.env.UPLOAD_TIMEOUT) || 30000,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024
    });
    if (data?.code !== 0) throw new Error();
    const publicUrl = new URL(data.url);
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password) throw new Error();
    return publicUrl.href;
  } catch {
    const error = new Error('图片上传服务未返回有效的 HTTPS 链接');
    error.statusCode = 502;
    throw error;
  }
}

module.exports = { uploadImage };
