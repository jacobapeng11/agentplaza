<template>
  <div class="link-app-editor-drawer">
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
        <el-select v-model="formData.newType" placeholder="请选择分类" style="width: 100%">
          <el-option
            v-for="category in availableCategories"
            :key="category.id"
            :label="category.name"
            :value="category.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="应用图标" prop="avatar">
        <el-upload
          class="avatar-uploader"
          :show-file-list="false"
          :http-request="handleUpload"
          :before-upload="beforeUpload"
          accept="image/*"
        >
          <img v-if="formData.avatar" :src="formData.avatar" class="avatar" />
          <div v-else class="avatar-placeholder">
            <el-icon>
              <Plus />
            </el-icon>
            <div class="upload-text">上传图标</div>
          </div>
        </el-upload>
        <div class="upload-tip">支持 jpg、png 格式，建议尺寸 200x200px，大小不超过 5MB</div>
      </el-form-item>

      <el-form-item label="应用标签" prop="tags">
        <TagSelector v-model="formData.tags" ref="tagSelectorRef" :max-tags="3" />
        <div class="form-tip">请按照三维度标签体系选择标签，最多3个</div>
      </el-form-item>

      <el-form-item label="人员权限" prop="userPermissions">
        <el-select
          v-model="formData.userPermissions"
          multiple
          filterable
          remote
          :remote-method="searchUsers"
          :loading="userSearchLoading"
          placeholder="搜索工号或姓名添加人员权限"
          style="width: 100%"
        >
          <el-option
            v-for="user in userOptions"
            :key="user.value"
            :label="user.label"
            :value="user.value"
          />
        </el-select>
        <div class="form-tip">搜索并选择有权限的人员工号，留空表示仅创建者可见</div>
      </el-form-item>

      <el-form-item label="部门权限" prop="deptPermissions">
        <el-cascader
          v-model="formData.deptPermissions"
          :options="deptTree"
          :props="cascaderProps"
          :show-all-levels="false"
          filterable
          clearable
          placeholder="选择或搜索有权限的部门"
          style="width: 100%"
          @focus="handleDeptFocus"
        >
          <template #default="{ data }">
            <span>{{ data.label }}</span>
          </template>
        </el-cascader>
        <div class="form-tip">可直接搜索部门名称，选择有权限的部门，留空表示仅创建者可见</div>
      </el-form-item>

      <div class="form-actions">
        <el-button @click="handleCancel">取消</el-button>
        <el-button
          type="primary"
          :loading="submitLoading"
          @click="handleSubmit"
        >{{ isEdit ? '更新' : '创建' }}</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { linkAppsApi } from '../api/appsLink'
import { linkAppFormRules } from '../utils/linkAppFormValidation'
import type { LinkApp, LinkAppFormData } from '../types/linkApp'
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import request from '../utils/request'
import TagSelector from './TagSelector.vue'

interface Props {
  appData?: LinkApp
  isEdit?: boolean
}

interface Emits {
  (e: 'success'): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  isEdit: false,
})

const emit = defineEmits<Emits>()

// 响应式数据
const formRef = ref<FormInstance>()
const tagSelectorRef = ref<any>(null)
const submitLoading = ref(false)
const uploadLoading = ref(false)
const availableCategories = ref<
  Array<{ id: string; name: string; icon?: string }>
>([])
const userOptions = ref<Array<{ value: string; label: string }>>([])
const userSearchLoading = ref(false)
const deptTree = ref<Array<any>>([])

// 级联选择器配置
const cascaderProps = {
  multiple: true,
  checkStrictly: true,
  emitPath: false,
  value: 'value',
  label: 'label',
  children: 'children',
}

// 表单数据
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

// 表单验证规则
const formRules = linkAppFormRules

// 计算属性
const isEditMode = computed(() => props.isEdit && !!props.appData)

// 搜索用户
let searchUserTimer: ReturnType<typeof setTimeout> | null = null
async function searchUsers(keyword: string) {
  if (!keyword || keyword.trim().length === 0) {
    userOptions.value = []
    return
  }

  // 防抖
  if (searchUserTimer) {
    clearTimeout(searchUserTimer)
  }

  searchUserTimer = setTimeout(async () => {
    try {
      userSearchLoading.value = true
      const response = await request.get('/search/users', {
        params: { keyword },
      })
      userOptions.value = response.data || []
    } catch (error) {
      console.error('搜索用户失败:', error)
      ElMessage.error('搜索用户失败')
    } finally {
      userSearchLoading.value = false
    }
  }, 300)
}

// 获取部门树
async function fetchDepartments() {
  try {
    console.log('[LinkAppEditor] 开始获取部门数据...')
    const response = await request.get('/search/departments')
    console.log('[LinkAppEditor] 部门接口响应:', response)
    deptTree.value = response.data || []
    console.log('[LinkAppEditor] 部门树数据:', deptTree.value)
  } catch (error) {
    console.error('获取部门列表失败:', error)
    ElMessage.error('获取部门列表失败')
  }
}

// 部门选择器获取焦点时，确保数据已加载
function handleDeptFocus() {
  if (deptTree.value.length === 0) {
    fetchDepartments()
  }
}

// 获取分类列表
async function fetchCategories() {
  try {
    const response = await request.get('/categories')
    console.log('[LinkAppEditor] 分类接口响应:', response)
    // response 本身就是 axios 拦截器处理后的 data，不需要再 .data
    const categories = response.data || []
    console.log('[LinkAppEditor] 分类数据:', categories)
    // 过滤掉"全部"分类
    availableCategories.value = categories.filter(
      (cat: any) => cat.id !== 'all'
    )
    console.log('[LinkAppEditor] 可用分类:', availableCategories.value)
  } catch (error) {
    console.error('获取分类失败:', error)
    ElMessage.error('获取分类列表失败')
  }
}

// 初始化表单数据
async function initFormData() {
  if (props.appData) {
    Object.assign(formData, {
      name: props.appData.name || '',
      appUrl: props.appData.appUrl || '',
      intro: props.appData.intro || '',
      newType: props.appData.newType || '',
      tags: [...(props.appData.tags || [])],
      avatar: props.appData.avatar || '',
      userPermissions: [...(props.appData.userPermissions || [])],
      deptPermissions: [...(props.appData.deptPermissions || [])],
    })

    // 加载已选择用户的显示信息
    if (
      props.appData.userPermissions &&
      props.appData.userPermissions.length > 0
    ) {
      await loadUserLabels(props.appData.userPermissions)
    }
  }
}

// 加载用户标签（用于回显）
async function loadUserLabels(badges: string[]) {
  try {
    // 为每个工号搜索对应的用户信息
    const promises = badges.map((badge) =>
      request.get('/search/users', { params: { keyword: badge } })
    )
    const results = await Promise.all(promises)

    const options: Array<{ value: string; label: string }> = []
    results.forEach((res, index) => {
      const users = res.data || []
      if (users.length > 0) {
        // 找到匹配的用户
        const user =
          users.find((u: any) => u.value === badges[index]) || users[0]
        options.push(user)
      } else {
        // 如果没找到，使用工号作为显示
        options.push({ value: badges[index], label: badges[index] })
      }
    })

    userOptions.value = options
  } catch (error) {
    console.error('加载用户信息失败:', error)
  }
}

// 图片上传
function beforeUpload(file: File) {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5

  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 5MB!')
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

// 表单提交
async function handleSubmit() {
  try {
    // 验证表单
    await formRef.value?.validate()

    // 验证标签
    if (tagSelectorRef.value && !tagSelectorRef.value.isValid) {
      ElMessage.warning(tagSelectorRef.value.validationMessage || '标签验证失败')
      return
    }

    submitLoading.value = true

    if (isEditMode.value) {
      await linkAppsApi.update(props.appData!._id, formData)
      ElMessage.success('更新成功')
    } else {
      await linkAppsApi.create(formData)
      ElMessage.success('创建成功')
    }

    emit('success')
  } catch (error: any) {
    console.error('Submit error:', error)
    
    // 处理表单验证错误
    if (error && typeof error === 'object' && !error.response) {
      // Element Plus 表单验证错误
      const firstErrorField = Object.keys(error)[0]
      if (firstErrorField && error[firstErrorField]) {
        const errorMessage = error[firstErrorField][0]?.message || '请检查表单填写'
        ElMessage.error(errorMessage)
      } else {
        ElMessage.error('请检查表单填写是否完整')
      }
      return
    }
    
    // 处理后端返回的错误
    if (error.response?.data?.message) {
      ElMessage.error(error.response.data.message)
    } else if (error.message) {
      ElMessage.error(error.message)
    } else {
      ElMessage.error(isEditMode.value ? '更新失败' : '创建失败')
    }
  } finally {
    submitLoading.value = false
  }
}

function handleCancel() {
  emit('cancel')
}

// 组件挂载时初始化
onMounted(() => {
  fetchCategories()
  fetchDepartments()
  initFormData()
})
</script>

<script lang="ts">
// 确保组件可以被正确导入
export default {
  name: 'LinkAppEditor',
}
</script>

<style scoped lang="scss">
.link-app-editor-drawer {
  padding: 20px;
}

.app-form {
  .el-form-item {
    margin-bottom: 24px;
  }
}

.avatar-uploader {
  margin-right: 20px;
  .avatar {
    width: 100px;
    height: 100px;
    border-radius: 8px;
    object-fit: cover;
    border: 1px solid #ddd;
  }

  .avatar-placeholder {
    width: 100px;
    height: 100px;
    border: 2px dashed #d9d9d9;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.3s;

    &:hover {
      border-color: #409eff;
    }

    .el-icon {
      font-size: 24px;
      color: #8c939d;
      margin-bottom: 8px;
    }

    .upload-text {
      font-size: 12px;
      color: #8c939d;
    }
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
  line-height: 1.5;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}
</style>