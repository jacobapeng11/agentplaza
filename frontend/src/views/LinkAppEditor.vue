<template>
  <div class="link-app-editor">
    <div class="editor-container">
      <div class="editor-header">
        <el-button text @click="goBack">
          <el-icon>
            <ArrowLeft />
          </el-icon>返回
        </el-button>
        <h1>{{ isEditMode ? '编辑' : '创建' }}外链应用</h1>
      </div>

      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="120px"
        class="app-form"
      >
        <el-form-item label="应用名称" prop="name">
          <el-input
            v-model="formData.name"
            placeholder="请输入应用名称（2-50个字符）"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="应用链接" prop="appUrl">
          <el-input v-model="formData.appUrl" placeholder="请输入应用链接（http:// 或 https://）" />
        </el-form-item>

        <el-form-item label="应用简介" prop="intro">
          <el-input
            v-model="formData.intro"
            type="textarea"
            :rows="4"
            placeholder="请输入应用简介（最多500个字符）"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="应用分类" prop="newType">
          <el-select v-model="formData.newType" placeholder="请选择分类">

            <el-option label="大市场" value="大市场" />
            <el-option label="财经类" value="财经类" />
            <el-option label="办公类" value="办公类" />
            <el-option label="行政类" value="行政类" />
            <el-option label="研发类" value="研发类" />
            <el-option label="综合类" value="综合类" />
          </el-select>
        </el-form-item>

        <el-form-item label="应用图标" prop="avatar">
          <el-upload
            class="avatar-uploader"
            :show-file-list="false"
            :before-upload="beforeUpload"
            :http-request="handleUpload"
            accept="image/jpeg, image/png, image/gif"
          >
            <img v-if="formData.avatar" :src="formData.avatar" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon">
              <Plus />
            </el-icon>
          </el-upload>
          <div class="upload-tip">支持 jpg/png/gif 格式，大小不超过 2MB</div>
        </el-form-item>

        <el-form-item label="应用标签" prop="tags">
          <el-select
            v-model="formData.tags"
            multiple
            filterable
            allow-create
            placeholder="请选择或输入标签（最多5个）"
          >
            <el-option label="效率工具" value="效率工具" />
            <el-option label="数据分析" value="数据分析" />
            <el-option label="自动化" value="自动化" />
          </el-select>
        </el-form-item>

        <el-form-item label="人员权限" prop="userPermissions">
          <el-select
            v-model="formData.userPermissions"
            multiple
            filterable
            allow-create
            placeholder="请输入工号（留空表示所有人可见）"
          />
          <div class="form-tip">输入特定工号限制访问，留空则所有人可见</div>
        </el-form-item>

        <el-form-item label="部门权限" prop="deptPermissions">
          <el-select
            v-model="formData.deptPermissions"
            multiple
            filterable
            allow-create
            placeholder="请输入部门代码（留空表示所有部门可见）"
          />
          <div class="form-tip">输入部门代码（如 DEPT-001）限制访问，留空则所有部门可见</div>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="submitting"
            @click="handleSubmit"
          >{{ isEditMode ? '保存修改' : '创建应用' }}</el-button>
          <el-button @click="goBack">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { linkAppsApi } from '../api/appsLink'
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import type { LinkAppFormData } from '../types/linkApp'
import {
  linkAppFormRules,
  validateImageFile,
} from '../utils/linkAppFormValidation'

const router = useRouter()
const route = useRoute()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const uploadLoading = ref(false)

const isEditMode = computed(() => !!route.params.id)

const formData = reactive<LinkAppFormData>({
  name: '',
  appUrl: '',
  intro: '',
  newType: '',
  tags: [],
  avatar: '',
  userPermissions: [],
  deptPermissions: [],
})

// 使用统一的验证规则
const formRules = linkAppFormRules

async function loadAppData() {
  if (!isEditMode.value) return

  try {
    const response: any = await linkAppsApi.getById(route.params.id as string)

    console.log('Edit mode - API response:', response)

    // 处理响应数据的不同结构
    const app = response?.data || response

    if (!app) {
      throw new Error('应用数据为空')
    }

    Object.assign(formData, {
      name: app.name || '',
      appUrl: app.appUrl || '',
      intro: app.intro || '',
      newType: app.newType || '',
      tags: app.tags || [],
      avatar: app.avatar || '',
      userPermissions: app.userPermissions || [],
      deptPermissions: app.deptPermissions || [],
    })

    console.log('Form data loaded:', formData)
  } catch (error: any) {
    console.error('Load app data error:', error)
    ElMessage.error(
      error.message || error.response?.data?.message || '加载应用数据失败'
    )
    goBack()
  }
}

function beforeUpload(file: File) {
  const validation = validateImageFile(file)
  if (!validation.valid) {
    ElMessage.error(validation.error!)
    return false
  }
  return true
}

async function handleUpload(options: UploadRequestOptions) {
  try {
    uploadLoading.value = true
    const response: any = await linkAppsApi.uploadImage(options.file as File)

    // 处理上传响应的不同结构
    const imageUrl = response?.data?.url || response?.url

    if (imageUrl) {
      formData.avatar = imageUrl
      ElMessage.success('上传成功')
    } else {
      throw new Error('上传响应中没有图片URL')
    }
  } catch (error: any) {
    console.error('Upload error:', error)
    ElMessage.error(
      error.message || error.response?.data?.message || '上传失败'
    )
  } finally {
    uploadLoading.value = false
  }
}

async function handleSubmit() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    submitting.value = true

    if (isEditMode.value) {
      await linkAppsApi.update(route.params.id as string, formData)
      ElMessage.success('更新成功')
    } else {
      await linkAppsApi.create(formData)
      ElMessage.success('创建成功')
    }

    router.push('/link-apps')
  } catch (error: any) {
    if (error.response) {
      ElMessage.error(error.response.data?.message || '提交失败')
    }
  } finally {
    submitting.value = false
  }
}

function goBack() {
  router.push('/link-apps')
}

onMounted(() => {
  loadAppData()
})
</script>

<style scoped lang="scss">
.link-app-editor {
  min-height: 100vh;
  background: #f5f5f7;
  padding: 20px;
}

.editor-container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 32px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.editor-header {
  margin-bottom: 32px;

  h1 {
    font-size: 24px;
    font-weight: 600;
    color: #333;
    margin: 12px 0 0 0;
  }
}

.app-form {
  max-width: 600px;
}

.avatar-uploader {
  .avatar {
    width: 120px;
    height: 120px;
    display: block;
    border-radius: 8px;
    object-fit: cover;
  }

  :deep(.el-upload) {
    border: 1px dashed #d9d9d9;
    border-radius: 8px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: border-color 0.3s;

    &:hover {
      border-color: #409eff;
    }
  }

  .avatar-uploader-icon {
    font-size: 28px;
    color: #8c939d;
    width: 120px;
    height: 120px;
    text-align: center;
    line-height: 120px;
  }
}

.upload-tip {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}

.form-tip {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
</style>
