<template>
  <div class="mcp-publish-page">
    <PlazaHeader />

    <main class="publish-main">
      <Breadcrumb :items="breadcrumbItems" />

      <section class="publish-hero">
        <div class="publish-hero__copy">
          <p class="eyebrow">MCP 服务配置</p>
          <h1>{{ isEditing ? '编辑 MCP' : '创建 MCP' }}</h1>
          <p>
            {{ isEditing
              ? '调整展示内容或网络配置后，系统会重新同步 Higress 路由。'
              : '填写展示内容和网络信息后，系统会为该服务生成统一的 MCP 接入地址。' }}
          </p>
        </div>
      </section>

      <section class="publish-layout" v-loading="loading">
        <el-form ref="formRef" :model="form" :rules="rules" class="publish-form">
          <section class="connection-mode-panel">
            <div>
              <p class="eyebrow">接入方式</p>
              <h2>{{ isSimpleMode ? '快速接入' : '高级配置' }}</h2>
              <p>{{ isSimpleMode ? '填写服务名称、服务地址和使用范围，其余连接信息由系统自动识别。' : '适用于 OpenAPI、认证透传或需要手工调整路由的服务。' }}</p>
            </div>
            <el-segmented v-model="connectionMode" :options="connectionModeOptions" :disabled="isOpenApiService" />
          </section>

          <section v-if="isSimpleMode" class="form-section simple-connect-section">
            <div class="section-head">
              <span class="step-mark">01</span>
              <div>
                <h2>连接已有 MCP 服务</h2>
                <p>只需填写以下三项，系统会帮你完成连接设置。</p>
              </div>
            </div>

            <div class="simple-connect-fields">
              <el-form-item label="MCP 名称" prop="displayName" required>
                <el-input v-model="form.displayName" maxlength="120" placeholder="例如：企业知识库 MCP" />
              </el-form-item>
              <el-form-item label="服务地址" prop="upstreamUrl" required>
                <el-input v-model="form.upstreamUrl" placeholder="https://example.com/mcp" @blur="handleSimpleUpstreamBlur" />
                <div class="field-tip">填写已有 MCP 服务提供的 HTTP 或 HTTPS 地址。</div>
              </el-form-item>
              <el-form-item label="谁可以使用" prop="visibilityMode">
                <el-segmented v-model="form.visibilityMode" :options="simpleVisibilityOptions" />
                <div class="field-tip">指定人员/部门可见时，请至少选择一个人员或部门。</div>
              </el-form-item>
              <template v-if="form.visibilityMode === 'restricted'">
                <el-form-item label="人员权限" prop="userPermissions">
                  <el-select
                    v-model="form.userPermissions"
                    multiple
                    filterable
                    remote
                    :remote-method="searchUsers"
                    :loading="userSearchLoading"
                    placeholder="搜索工号或姓名添加人员权限"
                  >
                    <el-option
                      v-for="user in userOptions"
                      :key="user.value"
                      :label="user.label"
                      :value="user.value"
                    />
                  </el-select>
                  <div class="field-tip">选择后，对应人员可在 MCP 市场看到并使用该服务。</div>
                </el-form-item>
                <el-form-item label="部门权限" prop="deptPermissions">
                  <el-cascader
                    v-model="form.deptPermissions"
                    :options="deptTree"
                    :props="cascaderProps"
                    :show-all-levels="false"
                    filterable
                    clearable
                    placeholder="选择或搜索有权限的部门"
                    @focus="handleDeptFocus"
                  >
                    <template #default="{ data }">
                      <span>{{ data.label }}</span>
                    </template>
                  </el-cascader>
                  <div class="field-tip">选择部门后，该部门及下级部门成员可见；留空则不会额外授权部门。</div>
                </el-form-item>
              </template>
            </div>

            <div v-if="connectionPreview" class="connection-preview-card" :class="{ 'connection-preview-card--error': !connectionPreview.reachable }">
              <div class="connection-preview-card__head">
                <strong>{{ connectionPreview.reachable ? '已识别服务连接方式' : '暂未完成连接验证' }}</strong>
                <span>{{ connectionPreview.reachable ? `发现 ${connectionPreview.toolCount} 个工具` : '请检查服务地址或认证设置' }}</span>
              </div>
              <template v-if="connectionPreview.reachable">
                <p>{{ connectionPreview.source.serviceSourceProtocol.toUpperCase() }} · {{ connectionPreview.source.serviceSourceDomain }}:{{ connectionPreview.source.serviceSourcePort }}</p>
                <p v-if="connectionPreview.routeAdaptation.path">系统会保留原服务路径：{{ connectionPreview.routeAdaptation.path }}</p>
              </template>
              <p v-else>{{ connectionPreview.errorMessage }}</p>
              <el-button text type="primary" @click="connectionMode = 'advanced'">查看或调整高级设置</el-button>
            </div>

            <div class="simple-connect-actions">
              <div class="simple-connect-transport">
                <span>传输方式</span>
                <el-segmented v-model="form.transport" :options="transportOptions" />
              </div>
              <el-button :loading="testingConnection" @click="testConnection">测试连接</el-button>
            </div>

            <p v-if="simpleDraftSavedAt" class="simple-draft-note">基础信息已在当前浏览器会话中保存，{{ simpleDraftSavedAt }}。</p>
          </section>

          <section v-if="isAdvancedMode" class="form-section">
            <div class="section-head">
              <span class="step-mark">01</span>
              <div>
                <h2>MCP 页面展示内容</h2>
              </div>
            </div>

            <div class="editor-panel">
              <div class="editor-row">
                <div class="editor-label required">MCP 名称</div>
                <el-form-item prop="displayName" class="editor-field">
                  <el-input
                    v-model="form.displayName"
                    maxlength="120"
                    show-word-limit
                    placeholder="例如：企业知识库 MCP"
                  />
                </el-form-item>
              </div>

              <div class="editor-row">
                <div class="editor-label required">一句话摘要</div>
                <el-form-item prop="summary" class="editor-field">
                  <el-input
                    v-model="form.summary"
                    maxlength="240"
                    show-word-limit
                    placeholder="用一句话说明这个 MCP 能帮助用户做什么"
                  />
                </el-form-item>
              </div>

              <div class="editor-row editor-row--top">
                <div class="editor-label required">详细介绍</div>
                <div class="editor-field editor-field--stack">
                  <el-form-item prop="description" class="editor-field__item">
                    <el-input
                      v-model="form.description"
                      type="textarea"
                      :rows="6"
                      maxlength="4000"
                      show-word-limit
                      placeholder="补充 MCP 的使用场景、能力边界、返回结果示例等详细说明"
                    />
                  </el-form-item>
                  <div class="field-tip">支持 Markdown 语法，例如标题、列表、加粗、链接和代码块。</div>
                </div>
              </div>

              <div class="editor-row">
                <div class="editor-label">应用分类</div>
                <el-form-item prop="category" class="editor-field">
                  <el-select v-model="form.category" placeholder="请选择分类">
                    <el-option
                      v-for="category in categoryOptions"
                      :key="category"
                      :label="category"
                      :value="category"
                    />
                  </el-select>
                </el-form-item>
              </div>

              <div class="editor-row">
                <div class="editor-label">可见性</div>
                <el-form-item prop="visibilityMode" class="editor-field">
                  <el-segmented v-model="form.visibilityMode" :options="visibilityOptions" />
                </el-form-item>
              </div>

              <template v-if="form.visibilityMode === 'restricted'">
                <div class="editor-row">
                  <div class="editor-label">人员权限</div>
                  <div class="editor-field editor-field--stack">
                    <el-form-item prop="userPermissions" class="editor-field__item">
                      <el-select
                        v-model="form.userPermissions"
                        multiple
                        filterable
                        remote
                        :remote-method="searchUsers"
                        :loading="userSearchLoading"
                        placeholder="搜索工号或姓名添加人员权限"
                      >
                        <el-option
                          v-for="user in userOptions"
                          :key="user.value"
                          :label="user.label"
                          :value="user.value"
                        />
                      </el-select>
                    </el-form-item>
                    <div class="field-tip">选择后对应人员可在 MCP 市场看到并使用该服务。</div>
                  </div>
                </div>

                <div class="editor-row">
                  <div class="editor-label">部门权限</div>
                  <div class="editor-field editor-field--stack">
                    <el-form-item prop="deptPermissions" class="editor-field__item">
                      <el-cascader
                        v-model="form.deptPermissions"
                        :options="deptTree"
                        :props="cascaderProps"
                        :show-all-levels="false"
                        filterable
                        clearable
                        placeholder="选择或搜索有权限的部门"
                        @focus="handleDeptFocus"
                      >
                        <template #default="{ data }">
                          <span>{{ data.label }}</span>
                        </template>
                      </el-cascader>
                    </el-form-item>
                    <div class="field-tip">选择部门后，该部门及下级部门成员可见；留空则不会额外授权部门。</div>
                  </div>
                </div>
              </template>

              <div class="editor-row editor-row--top">
                <div class="editor-label">应用图标</div>
                <div class="editor-field editor-field--plain">
                  <div class="fixed-avatar-shell">
                    <img :src="form.avatar" class="avatar-image" alt="MCP 默认图标" />
                  </div>
                  <div class="upload-copy">
                    <div class="upload-title">MCP 图标已改为固定默认图标</div>
                    <div class="upload-subtitle">该图标会同步展示在 MCP 市场、详情页和我的 MCP 卡片中。</div>
                  </div>
                </div>
              </div>

              <div class="editor-row editor-row--last">
                <div class="editor-label">应用标签</div>
                <div class="editor-field editor-field--stack">
                  <el-form-item prop="tags" class="editor-field__item">
                    <el-select
                      v-model="form.tags"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      :multiple-limit="5"
                      placeholder="请输入或选择标签，最多 5 个"
                    >
                      <el-option v-for="tag in tagOptions" :key="tag" :label="tag" :value="tag" />
                    </el-select>
                  </el-form-item>
                  <div class="field-tip">建议保留核心能力标签，方便在 MCP 市场中检索与分类。</div>
                </div>
              </div>
            </div>
          </section>

          <section v-if="isAdvancedMode" class="form-section">
            <div class="section-head">
              <span class="step-mark">02</span>
              <div>
                <h2>MCP 网络信息</h2>
                <p>用于配置上游服务来源、传输方式以及 Higress 的访问路由。</p>
              </div>
            </div>

            <div class="sub-section">
              <div class="sub-section__head">
                <h3>Higress MCP 来源类型</h3>
                <p>不同来源会生成不同的 Higress MCP Server 配置。</p>
              </div>

              <el-form-item label="来源类型" prop="higressMcpType">
                <el-segmented v-model="form.higressMcpType" :options="sourceTypeOptions" :disabled="isEditing" />
                <div class="field-tip">直接路由适合原生 MCP 服务；OpenAPI 转换适合先提供 OpenAPI 文档，再由 Higress 生成 MCP 工具。</div>
              </el-form-item>
            </div>

            <div v-if="form.higressMcpType === 'OPEN_API'" class="sub-section">
              <div class="sub-section__head">
                <h3>OpenAPI 转 MCP 配置</h3>
                <p>OpenAPI 文档只用于生成 MCP 工具，实际调用会转发到下方配置的 REST API 后端服务。</p>
              </div>

              <el-form-item label="输入方式" prop="openApiInputMode">
                <el-segmented v-model="form.openApiInputMode" :options="openApiInputModeOptions" />
                <div class="field-tip">选择“粘贴内容”时直接填写文档原文；选择“文档 URL”时由系统拉取内容并同步到 Higress。</div>
              </el-form-item>

              <el-form-item v-if="form.openApiInputMode === 'content'" label="OpenAPI 内容" prop="openApiContent">
                <el-input
                  v-model="form.openApiContent"
                  type="textarea"
                  :rows="8"
                  placeholder="openapi: 3.0.3..."
                />
                <div class="field-tip">支持 JSON 或 YAML；建议填写完整文档内容，便于 Higress 正确解析工具定义。</div>
              </el-form-item>

              <el-form-item v-else label="OpenAPI URL" prop="openApiUrl">
                <el-input v-model="form.openApiUrl" placeholder="https://example.com/openapi.yaml" />
                <div class="field-tip">填写可被服务端访问的文档地址，例如 `https://example.com/openapi.yaml`。</div>
              </el-form-item>
            </div>

            <div v-if="form.higressMcpType === 'OPEN_API'" class="sub-section">
              <div class="sub-section__head">
                <h3>后端认证透传</h3>
                <p>仅配置凭证的来源和目标，不在 AgentPlaza 保存真实 JWT 或 API Key；凭证由 MCP Client 在调用时提供，并由原始后端校验。</p>
              </div>
              <el-form-item label="启用透明认证">
                <el-switch v-model="form.openApiAuthConfig.enabled" />
              </el-form-item>
              <template v-if="form.openApiAuthConfig.enabled">
                <el-form-item label="凭证类型">
                  <el-radio-group v-model="form.openApiAuthConfig.credentialType">
                    <el-radio value="bearer">JWT Bearer</el-radio>
                    <el-radio value="apiKey">API Key</el-radio>
                  </el-radio-group>
                </el-form-item>
                <template v-if="form.openApiAuthConfig.credentialType === 'bearer'">
                  <el-form-item label="客户端来源">
                    <el-input model-value="Authorization: Bearer &lt;JWT&gt;" disabled />
                  </el-form-item>
                  <el-form-item label="后端目标">
                    <el-radio-group v-model="form.openApiAuthConfig.backend!.scheme">
                      <el-radio value="bearer">Authorization Bearer</el-radio>
                      <el-radio value="apiKey">自定义 Header</el-radio>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item v-if="form.openApiAuthConfig.backend!.scheme !== 'bearer'" label="后端 Header 名称" required>
                    <el-input v-model="form.openApiAuthConfig.backend!.name" placeholder="X-Access-Token" />
                  </el-form-item>
                </template>
                <template v-else>
                  <div class="field-grid two">
                    <el-form-item label="客户端位置" required>
                      <el-select v-model="form.openApiAuthConfig.client!.in">
                        <el-option label="Header" value="header" />
                        <el-option label="Query" value="query" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="客户端参数名" required>
                      <el-input v-model="form.openApiAuthConfig.client!.name" placeholder="X-API-Key" />
                    </el-form-item>
                    <el-form-item label="后端位置" required>
                      <el-select v-model="form.openApiAuthConfig.backend!.in">
                        <el-option label="Header" value="header" />
                        <el-option label="Query（存在日志泄漏风险）" value="query" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="后端参数名" required>
                      <el-input v-model="form.openApiAuthConfig.backend!.name" placeholder="X-API-Key" />
                    </el-form-item>
                  </div>
                </template>
              </template>
            </div>

            <div class="sub-section">
              <div class="sub-section__head">
                <h3>{{ form.higressMcpType === 'OPEN_API' ? 'REST API 后端服务来源' : '上游服务来源' }}</h3>
                <p>{{ form.higressMcpType === 'OPEN_API'
                  ? '实际调用会转发到这里配置的 REST API 后端服务；不要填写 OpenAPI 文档服务地址。'
                  : '告诉网关这个服务来自哪里，以及采用什么协议访问。' }}</p>
              </div>

              <template v-if="form.higressMcpType === 'DIRECT_ROUTE'">
                <el-form-item label="上游地址" prop="upstreamUrl" required>
                  <el-input
                    v-model="form.upstreamUrl"
                    placeholder="https://example.com/mcp"
                    @blur="inferFromUpstream"
                  />
                  <div class="field-tip">填写上游原始 MCP 地址。失焦后系统会尝试自动推断服务来源、端口、协议和默认路由。</div>
                </el-form-item>
              </template>

              <div class="field-grid four field-grid--network">
                <el-form-item label="来源类型" prop="serviceSourceType">
                  <el-select v-model="form.serviceSourceType">
                    <el-option label="DNS" value="dns" />
                    <el-option label="静态 IP" value="static" />
                  </el-select>
                  <div class="field-tip">域名上游通常选择 DNS；固定 IP 上游选择静态 IP。</div>
                </el-form-item>

                <el-form-item label="服务地址" prop="serviceSourceDomain">
                  <el-input
                    v-model="form.serviceSourceDomain"
                    placeholder="例如：upstream.example.com"
                  />
                  <div class="field-tip">DNS 类型填写域名；静态 IP 类型填写主机地址。</div>
                </el-form-item>

                <el-form-item label="服务端口" prop="serviceSourcePort">
                  <el-input-number
                    v-model="form.serviceSourcePort"
                    :min="1"
                    :max="65535"
                    controls-position="right"
                  />
                  <div class="field-tip">填写上游服务监听端口，例如 80、443、3307。</div>
                </el-form-item>

                <el-form-item label="服务协议" prop="serviceSourceProtocol" required>
                  <el-select v-model="form.serviceSourceProtocol" placeholder="请选择">
                    <el-option label="HTTP" value="http" />
                    <el-option label="HTTPS" value="https" />
                  </el-select>
                  <div class="field-tip">与上游服务实际协议保持一致；原生 MCP 常见为 HTTP 或 HTTPS。</div>
                </el-form-item>
              </div>


              <div v-if="form.higressMcpType === 'DIRECT_ROUTE'" class="route-plugin-panel">
                <div class="sub-section__head compact">
                  <div>
                    <h3>高级功能</h3>
                    <p>按需配置 Higress 路由能力：rewrite 处理上游路径和 Host，headermodify 补充上游所需请求头，transformer 可把调用方 Header 中的 apikey 映射为上游 query 参数。</p>
                  </div>
                  <el-switch v-model="advancedFeaturesEnabled" aria-label="启用高级功能配置" />
                </div>

                <template v-if="advancedFeaturesEnabled">
                  <div class="plugin-card">
                    <div class="plugin-card__head">
                      <strong>rewrite</strong>
                      <div class="plugin-card__actions">
                        <el-button class="plugin-doc-button" text size="small" @click="openPluginDoc('rewrite')">使用说明</el-button>
                        <el-switch v-model="form.routePluginConfig.rewrite.enabled" />
                      </div>
                    </div>
                    <div class="field-tip">用于把网关入口路径或 Host 改写为上游实际要求的值。</div>
                    <div class="field-grid two">
                      <el-form-item label="重写路径">
                        <el-input v-model="form.routePluginConfig.rewrite.path" placeholder="/mcp/server/xxx/mcp" />
                        <div class="field-tip">填写上游真实 MCP 路径；不需要改路径时可留空。</div>
                      </el-form-item>
                      <el-form-item label="重写主机">
                        <el-input v-model="form.routePluginConfig.rewrite.host" placeholder="upstream.example.com" />
                        <div class="field-tip">需要改写 Host 请求头时填写上游域名；不需要可留空。</div>
                      </el-form-item>
                    </div>
                  </div>

                  <div class="plugin-card">
                    <div class="plugin-card__head">
                      <strong>headermodify</strong>
                      <div class="plugin-card__actions">
                        <el-button class="plugin-doc-button" text size="small" @click="openPluginDoc('headerModify')">使用说明</el-button>
                        <el-switch v-model="form.routePluginConfig.headerModify.enabled" />
                      </div>
                    </div>
                    <el-form-item label="Header 配置 JSON">
                      <el-input
                        v-model="headerModifyJsonText"
                        type="textarea"
                        @blur="commitHeaderModifyJson"
                        :rows="6"
                      />
                    </el-form-item>
                  </div>

                  <div class="plugin-card">
                    <div class="plugin-card__head">
                      <strong>transformer</strong>
                      <div class="plugin-card__actions">
                        <el-button class="plugin-doc-button" text size="small" @click="openPluginDoc('transformer')">使用说明</el-button>
                        <el-switch v-model="form.routePluginConfig.transformer.enabled" />
                      </div>
                    </div>
                    <el-form-item label="transformer YAML">
                      <el-input
                        v-model="form.routePluginConfig.transformer.rawConfigurations"
                        type="textarea"
                        :rows="6"
                      />
                    </el-form-item>
                  </div>
                </template>
              </div>
            </div>

            <div class="sub-section">
              <div class="sub-section__head">
                <h3>网关与访问路由</h3>
                <p>{{ form.higressMcpType === 'OPEN_API'
                  ? 'OpenAPI 来源使用 Higress MCP Server 固定接入点，不使用普通路由路径。'
                  : '决定客户端最终通过哪个协议和路径访问这个 MCP 服务，请选择与来源相同的协议。' }}</p>
              </div>

              <div class="field-grid three field-grid--gateway">
                <el-form-item label="传输方式" prop="transport">
                  <el-segmented v-model="form.transport" :options="transportOptions" />
                  <div class="field-tip">Streamable HTTP 适合常规 HTTP MCP；SSE 适合服务端事件流模式。</div>
                </el-form-item>

                <el-form-item label="网关域名" prop="gatewayDomain">
                  <el-input v-model="form.gatewayDomain" disabled />
                  <div class="field-tip">由环境变量统一控制，用于生成对外访问地址。</div>
                </el-form-item>

                <el-form-item v-if="form.higressMcpType !== 'OPEN_API'" label="路由路径" prop="gatewayPath">
                  <el-input v-model="form.gatewayPath" disabled placeholder="系统自动生成" />
                  <div class="field-tip">这是最终暴露给调用方的 Higress 网关入口路径，直接路由必须与上游真实路径解耦。</div>
                </el-form-item>
              </div>

              <div v-if="form.higressMcpType === 'OPEN_API'" class="field-tip field-tip--inline">OpenAPI 来源最终访问地址由 Higress MCP Server 生成，格式为 /mcp-servers/&lt;mcp-name&gt;；保存同步后详情页会展示真实地址。</div>
              <div v-else class="field-tip field-tip--inline">网关域名由环境变量统一控制；路由路径是调用方最终访问的入口。若上游真实路径不同，请在 rewrite 中填写上游路径。</div>

              <div class="route-preview">
                <span>访问路由预览</span>
                <strong>{{ form.higressMcpType === 'OPEN_API' ? openApiGatewayPreviewUrl : finalGatewayUrl }}</strong>
                <p>当前接入方式：{{ transportText }}</p>
              </div>
            </div>
          </section>

          <div class="submit-bar">
            <el-button @click="resetForm">重置表单</el-button>
            <el-button type="primary" :loading="submitting" @click="submitForm">
              {{ isEditing ? '保存并重新同步' : '创建并同步接入' }}
            </el-button>
          </div>
        </el-form>

        <aside class="publish-guide">
          <div class="guide-card preview-guide">
            <p class="eyebrow">配置卡片预览</p>
            <article class="mcp-card mcp-card--preview">
              <div class="card-header">
                <div class="header-background bg-variant-0"></div>
                <div class="app-name-wrapper">
                  <h3 class="app-name" :title="previewName">{{ previewName }}</h3>
                  <div class="creator-badge" :title="form.category || '综合类'">{{ form.category || '综合类' }}</div>
                </div>
                <div class="card-avatar"><img class="mcp-icon" :src="form.avatar" alt="MCP 图标预览" /></div>
              </div>

              <div class="card-body">
                <h4 class="card-app-name" :title="previewName">{{ previewName }}</h4>
                <div class="card-tags">
                  <span class="tag-item tag-0">{{ form.category || '综合类' }}</span>
                  <span
                    v-for="(tag, index) in previewCardTags"
                    :key="tag"
                    class="tag-item"
                    :class="'tag-' + ((index + 1) % 4)"
                  >{{ tag }}</span>
                </div>
                <p class="card-description" :title="form.summary || '一句话摘要会展示在这里。'">{{ form.summary || '一句话摘要会展示在这里。' }}</p>
              </div>

              <div class="card-footer">
                <div class="stats-left">
                  <div class="stat-item">
                    <img class="stat-icon" src="/appIcon1.png" alt="visibility" />
                    <span>{{ previewVisibilityText }}</span>
                  </div>
                </div>
              </div>

              <div class="card-hover-overlay" />
            </article>
          </div>
        </aside>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import Breadcrumb from '../components/common/Breadcrumb.vue'
import { mcpApi } from '../api/mcp'
import type {
  CreateMcpPayload,
  HigressMcpType,
  HigressServiceProtocol,
  HigressServiceSourceType,
  McpConnectionPreview,
  McpDetailItem,
  McpRoutePluginConfig,
  McpTransport,
  McpVisibilityMode,
  OpenApiInputMode,
  OpenApiAuthConfig,
  UpdateMcpPayload
} from '../types/mcp'
import { getAppConfigValue } from '../config/runtimeConfig'
import { getTransportLabel } from '../utils/mcpPresentation'
import request from '../utils/request'

const route = useRoute()
const router = useRouter()
const DEFAULT_MCP_AVATAR = '/mcp-logo.webp'

function normalizeGatewayBaseUrl(value?: unknown) {
  const normalized = String(value || '').trim()
  const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`
  return normalized ? withProtocol.replace(/\/+$/, '') : ''
}

function extractGatewayDomain(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  }
}

function normalizeGatewayPathWithTransport(path: string, _transport: McpTransport) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized || '/'
}


function createEmptyHeaderStage() {
  return {
    add: [],
    set: [],
    remove: []
  }
}

function createDefaultRoutePluginConfig(): McpRoutePluginConfig {
  return {
    rewrite: {
      enabled: false,
      path: '',
      host: ''
    },
    headerModify: {
      enabled: false,
      request: createEmptyHeaderStage(),
      response: createEmptyHeaderStage()
    },
    keyAuth: {
      enabled: false,
      allowedCredentialTypes: ['key-auth'],
      allowedConsumers: [],
      rawConfigurations: ''
    },
    transformer: {
      enabled: false,
      rawConfigurations: ''
    }
  }
}

function cloneRoutePluginConfig(value?: McpRoutePluginConfig): McpRoutePluginConfig {
  const defaults = createDefaultRoutePluginConfig()
  if (!value) return defaults
  return {
    rewrite: {
      ...defaults.rewrite,
      ...(value.rewrite || {})
    },
    headerModify: {
      enabled: Boolean(value.headerModify?.enabled),
      request: {
        ...defaults.headerModify.request,
        ...(value.headerModify?.request || {})
      },
      response: {
        ...defaults.headerModify.response,
        ...(value.headerModify?.response || {})
      }
    },
    keyAuth: {
      ...defaults.keyAuth,
      ...(value.keyAuth || {})
    },
    transformer: {
      ...defaults.transformer,
      ...(value.transformer || {})
    }
  }
}

function createDefaultOpenApiAuthConfig(): OpenApiAuthConfig {
  return {
    enabled: false,
    credentialType: 'bearer',
    client: { in: 'header', name: 'Authorization', scheme: 'bearer' },
    backend: { in: 'header', name: 'Authorization', scheme: 'bearer' },
    applyTo: { mode: 'all', toolNames: [] }
  }
}

function cloneOpenApiAuthConfig(value?: OpenApiAuthConfig): OpenApiAuthConfig {
  const defaults = createDefaultOpenApiAuthConfig()
  return {
    ...defaults,
    ...(value || {}),
    client: { ...defaults.client!, ...(value?.client || {}) },
    backend: { ...defaults.backend!, ...(value?.backend || {}) },
    applyTo: { ...defaults.applyTo!, ...(value?.applyTo || {}), toolNames: [...(value?.applyTo?.toolNames || [])] }
  }
}

const formRef = ref<FormInstance>()
const loading = ref(false)
const submitting = ref(false)
const isEditing = computed(() => Boolean(route.params.id))
const serviceId = computed(() => String(route.params.id || ''))
const gatewayBaseUrl = normalizeGatewayBaseUrl(getAppConfigValue('VITE_MCP_GATEWAY_BASE_URL'))
const gatewayDomain = extractGatewayDomain(gatewayBaseUrl)

const breadcrumbItems = computed(() => [
  { label: '智能体广场', path: '/' },
  { label: 'MCP 市场', path: '/mcp' },
  { label: isEditing.value ? '编辑 MCP' : '创建 MCP' }
])

const defaultFormState = (): CreateMcpPayload => ({
  displayName: '',
  summary: '',
  description: '',
  avatar: DEFAULT_MCP_AVATAR,
  category: '综合类',
  tags: ['MCP 服务'],
  visibilityMode: 'private',
  higressMcpType: 'DIRECT_ROUTE',
  transport: 'streamable',
  upstreamUrl: '',
  openApiInputMode: 'content',
  openApiContent: '',
  openApiUrl: '',
  openApiAuthConfig: createDefaultOpenApiAuthConfig(),
  serviceSourceType: 'dns',
  serviceSourceDomain: '',
  serviceSourcePort: 443,
  serviceSourceProtocol: 'https',
  gatewayDomain,
  gatewayPath: createGeneratedGatewayPath(),
  routePluginConfig: createDefaultRoutePluginConfig()
})

const form = reactive<CreateMcpPayload>(defaultFormState())
const connectionMode = ref<'simple' | 'advanced'>('simple')
const testingConnection = ref(false)
const connectionPreview = ref<McpConnectionPreview | null>(null)
const simpleDraftSavedAt = ref('')
const SIMPLE_DRAFT_STORAGE_KEY = 'agentplaza.mcp.simple-draft.v1'

const connectionModeOptions = [
  { label: '快速接入', value: 'simple' },
  { label: '高级配置', value: 'advanced' }
]

const simpleVisibilityOptions = [
  { label: '仅自己', value: 'private' },
  { label: '全员可用', value: 'public' },
  { label: '指定人员/部门可见', value: 'restricted' }
]

const isOpenApiService = computed(() => form.higressMcpType === 'OPEN_API')
const isSimpleMode = computed(() => connectionMode.value === 'simple' && !isOpenApiService.value)
const isAdvancedMode = computed(() => !isSimpleMode.value)

const categoryOptions = ['综合类', '大市场', '财经类', '办公类', '行政类', '研发类']
const tagOptions = ['MCP 服务', '效率工具', '知识库', '数据查询', '办公协同', '研发工具']

const transportOptions = [
  { label: '可流式 HTTP', value: 'streamable' },
  { label: 'SSE', value: 'sse' }
]

const visibilityOptions = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
  { label: '指定人员/部门可见', value: 'restricted' }
]

const sourceTypeOptions = [
  { label: '直接路由', value: 'DIRECT_ROUTE' },
  { label: 'OpenAPI 转换', value: 'OPEN_API' }
]

const openApiInputModeOptions = [
  { label: '粘贴内容', value: 'content' },
  { label: '文档 URL', value: 'url' }
]

const routePluginDocUrls = {
  rewrite: 'https://higress.cn/docs/latest/user/annotation-use-case/#rewrite%E9%87%8D%E5%86%99path%E5%92%8Chost',
  headerModify: 'https://higress.cn/docs/latest/user/annotation-use-case/#header%E6%8E%A7%E5%88%B6',
  transformer: 'https://higress.cn/docs/latest/plugins/transformation/transformer/'
} as const


const userOptions = ref<Array<{ value: string; label: string }>>([])
const userSearchLoading = ref(false)
const deptTree = ref<Array<any>>([])
const cascaderProps = {
  multiple: true,
  checkStrictly: true,
  emitPath: false,
  value: 'value',
  label: 'label',
  children: 'children'
}
let searchUserTimer: ReturnType<typeof setTimeout> | null = null

function createGeneratedGatewayPath() {
  const randomSource = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  const routeKey = randomSource.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `/mcp/services/${routeKey || Date.now().toString(36)}`
}

const rules: FormRules = {
  displayName: [{ required: true, message: '请输入 MCP 名称', trigger: 'blur' }],
  summary: [{ required: true, message: '请输入一句话摘要', trigger: 'blur' }],
  description: [{ required: true, message: '请输入详细介绍', trigger: 'blur' }],
  upstreamUrl: [{ validator: validateUpstreamUrl, trigger: 'blur' }],
  serviceSourceType: [{ required: true, message: '请选择来源类型', trigger: 'change' }],
  serviceSourceDomain: [{ required: true, message: '请输入服务地址', trigger: 'blur' }],
  serviceSourcePort: [{ required: true, message: '\u8bf7\u8f93\u5165\u670d\u52a1\u7aef\u53e3', trigger: 'blur' }],
  serviceSourceProtocol: [{ required: true, message: '\u8bf7\u9009\u62e9\u670d\u52a1\u534f\u8bae', trigger: 'change' }],
  gatewayDomain: [{ required: true, message: '请输入网关域名', trigger: 'blur' }],
  gatewayPath: [
    { required: true, message: '请输入路由路径', trigger: 'blur' },
    { validator: validateGatewayPath, trigger: ['blur', 'change'] }
  ]
}

const transportText = computed(() => getTransportLabel(form.transport))
const previewName = computed(() => form.displayName || '未命名 MCP')
const sourceTypeText = computed(() => form.higressMcpType === 'OPEN_API' ? 'OpenAPI 转换' : '直接路由')
const previewVisibilityText = computed(() => {
  if (form.visibilityMode === 'public') return '公开可见'
  if (form.visibilityMode === 'restricted') return '指定可见'
  return '仅创建者可见'
})
const previewCardTags = computed(() => {
  const tags = [sourceTypeText.value, transportText.value, ...(form.tags || [])]
  return Array.from(new Set(tags.filter(Boolean))).slice(0, 3)
})

const advancedFeaturesEnabled = ref(false)
const headerModifyJsonText = ref('')

function hasHeaderModifyRules(config = form.routePluginConfig?.headerModify) {
  if (!config) return false
  return [config.request, config.response].some((stage) => (
    Boolean(stage?.add?.length || stage?.set?.length || stage?.remove?.length)
  ))
}

function syncHeaderModifyJsonText() {
  const config = form.routePluginConfig?.headerModify
  headerModifyJsonText.value = hasHeaderModifyRules(config)
    ? JSON.stringify(config, null, 2)
    : ''
}

function commitHeaderModifyJson() {
  const text = String(headerModifyJsonText.value || '').trim()
  if (!text) {
    form.routePluginConfig.headerModify = {
      ...createDefaultRoutePluginConfig().headerModify,
      enabled: form.routePluginConfig.headerModify.enabled
    }
    return
  }

  try {
    const parsed = JSON.parse(text)
    form.routePluginConfig.headerModify = {
      ...createDefaultRoutePluginConfig().headerModify,
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      enabled: form.routePluginConfig.headerModify.enabled
    }
    syncHeaderModifyJsonText()
  } catch {
    ElMessage.warning('Header 配置 JSON 格式不正确，请检查后再试')
  }
}

function openPluginDoc(pluginName: keyof typeof routePluginDocUrls) {
  const docUrl = routePluginDocUrls[pluginName]
  if (!docUrl) return
  window.open(docUrl, '_blank', 'noopener,noreferrer')
}

watch(
  () => form.routePluginConfig.headerModify,
  () => {
    syncHeaderModifyJsonText()
  },
  { deep: true, immediate: true }
)

const finalGatewayUrl = computed(() => {
  const path = normalizeGatewayPath()
  return path ? `${gatewayBaseUrl}${path}` : gatewayBaseUrl
})

const openApiGatewayPreviewUrl = computed(() => `${gatewayBaseUrl}/mcp-servers/<保存后生成>`)

async function searchUsers(keyword: string) {
  if (!keyword || keyword.trim().length === 0) {
    userOptions.value = []
    return
  }

  if (searchUserTimer) {
    clearTimeout(searchUserTimer)
  }

  searchUserTimer = setTimeout(async () => {
    try {
      userSearchLoading.value = true
      const response: any = await request.get('/search/users', {
        params: { keyword }
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

async function fetchDepartments() {
  try {
    const response: any = await request.get('/search/departments')
    deptTree.value = response.data || []
  } catch (error) {
    console.error('获取部门列表失败:', error)
    ElMessage.error('获取部门列表失败')
  }
}

function handleDeptFocus() {
  if (deptTree.value.length === 0) {
    fetchDepartments()
  }
}

async function loadUserLabels(badges: string[]) {
  if (!badges.length) {
    userOptions.value = []
    return
  }

  try {
    const results = await Promise.all(
      badges.map((badge) => request.get('/search/users', { params: { keyword: badge } }))
    )
    userOptions.value = results.map((res: any, index) => {
      const users = res.data || []
      return users.find((user: any) => user.value === badges[index]) || users[0] || {
        value: badges[index],
        label: badges[index]
      }
    })
  } catch (error) {
    console.error('加载用户信息失败:', error)
  }
}

function getPermissionPayload() {
  if (form.visibilityMode !== 'restricted') {
    return { userPermissions: [], deptPermissions: [] }
  }

  return {
    userPermissions: [...(form.userPermissions || [])],
    deptPermissions: [...(form.deptPermissions || [])]
  }
}

function hasRestrictedPermissionTarget() {
  return Boolean((form.userPermissions || []).length || (form.deptPermissions || []).length)
}

function validateUpstreamUrl(_rule: unknown, value: string, callback: (error?: Error) => void) {
  if (!String(value || '').trim()) {
    callback(new Error('请输入上游地址'))
    return
  }
  callback()
}

function validateGatewayPath(_rule: unknown, value: string, callback: (error?: Error) => void) {
  const normalized = String(value || '')
  if (normalized && !normalized.startsWith('/')) {
    callback(new Error('路由路径必须以 / 开头'))
    return
  }
  callback()
}

function isIpAddress(value: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')
}

function normalizeGatewayPath(value = form.gatewayPath) {
  if (!value) return ''
  return value.startsWith('/') ? value : `/${value}`
}

function buildUpstreamUrlFromParts(
  protocol: HigressServiceProtocol | string,
  domain: string,
  port: number,
  path: string,
  transport: McpTransport
) {
  const normalizedProtocol = String(protocol || '').trim()
  const normalizedDomain = String(domain || '').trim()
  if (!normalizedProtocol || !normalizedDomain) return ''

  const normalizedPath = normalizeGatewayPathWithTransport(path || '/mcp', transport)
  const normalizedPort = Number(port || 0)
  const shouldOmitPort = (normalizedProtocol === 'http' && normalizedPort === 80)
    || (normalizedProtocol === 'https' && normalizedPort === 443)
  const portSegment = normalizedPort > 0 && !shouldOmitPort ? ':' + String(normalizedPort) : ''

  return normalizedProtocol + '://' + normalizedDomain + portSegment + normalizedPath
}

function buildExistingUpstreamUrl(detail: McpDetailItem) {
  return buildUpstreamUrlFromParts(
    detail.serviceSourceProtocol,
    detail.serviceSourceDomain,
    Number(detail.serviceSourcePort || 0),
    detail.gatewayPath || '/mcp',
    detail.transport
  )
}

function buildCurrentUpstreamUrl() {
  return buildUpstreamUrlFromParts(
    form.serviceSourceProtocol,
    form.serviceSourceDomain,
    Number(form.serviceSourcePort || 0),
    form.gatewayPath || '/mcp',
    form.transport
  )
}

function inferFromUpstream() {
  if (!form.upstreamUrl) return

  try {
    const url = new URL(form.upstreamUrl)
    const inferredPort = Number(url.port || (url.protocol === 'http:' ? 80 : 443))
    const inferredType = (isIpAddress(url.hostname) ? 'static' : 'dns') as HigressServiceSourceType
    form.serviceSourceType = inferredType
    form.serviceSourceDomain = url.hostname
    form.serviceSourcePort = inferredPort
    form.serviceSourceProtocol = url.protocol.replace(':', '') as HigressServiceProtocol

    const upstreamPath = normalizeGatewayPathWithTransport((url.pathname || '/') + url.search, form.transport)
    const rewrite = form.routePluginConfig.rewrite
    if (form.higressMcpType === 'DIRECT_ROUTE' && upstreamPath !== '/') {
      rewrite.enabled = true
      rewrite.path = upstreamPath
    }
    if (form.higressMcpType === 'DIRECT_ROUTE' && url.hostname && !rewrite.host) {
      rewrite.enabled = true
      rewrite.host = url.hostname
    }
  } catch {
    ElMessage.warning('上游地址格式不正确，暂时无法自动推断服务来源信息')
  }
}

function saveSimpleDraft() {
  if (typeof window === 'undefined' || isEditing.value) return
  const draft = {
    displayName: form.displayName,
    visibilityMode: form.visibilityMode,
    transport: form.transport,
    savedAt: new Date().toLocaleString('zh-CN', { hour12: false })
  }
  window.sessionStorage.setItem(SIMPLE_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  simpleDraftSavedAt.value = draft.savedAt
}

function restoreSimpleDraft() {
  if (typeof window === 'undefined' || isEditing.value) return
  try {
    const draft = JSON.parse(window.sessionStorage.getItem(SIMPLE_DRAFT_STORAGE_KEY) || '{}')
    if (!draft || typeof draft !== 'object') return
    if (!form.displayName && typeof draft.displayName === 'string') form.displayName = draft.displayName
    if (draft.visibilityMode === 'private' || draft.visibilityMode === 'public') form.visibilityMode = draft.visibilityMode
    if (draft.transport === 'streamable' || draft.transport === 'sse') form.transport = draft.transport
    simpleDraftSavedAt.value = String(draft.savedAt || '')
  } catch {
    window.sessionStorage.removeItem(SIMPLE_DRAFT_STORAGE_KEY)
  }
}

async function testConnection() {
  const upstreamUrl = String(form.upstreamUrl || '').trim()
  if (!upstreamUrl) {
    ElMessage.warning('请先填写服务地址')
    return
  }

  inferFromUpstream()
  testingConnection.value = true
  try {
    const response: any = await mcpApi.previewConnection({ upstreamUrl, transport: form.transport })
    const preview = response.data as McpConnectionPreview
    connectionPreview.value = preview
    if (preview.reachable) {
      const source = preview.source
      form.serviceSourceType = source.serviceSourceType
      form.serviceSourceDomain = source.serviceSourceDomain
      form.serviceSourcePort = source.serviceSourcePort
      form.serviceSourceProtocol = source.serviceSourceProtocol
      ElMessage.success(`连接成功，发现 ${preview.toolCount} 个工具`)
    } else {
      ElMessage.warning(preview.errorMessage || '暂未连接成功，请检查服务地址')
    }
  } catch (error: any) {
    connectionPreview.value = null
    ElMessage.warning(error?.message || '服务地址无法识别，请检查后重试')
  } finally {
    testingConnection.value = false
  }
}

async function handleSimpleUpstreamBlur() {
  inferFromUpstream()
  await testConnection()
}

function applySimpleModeDefaults() {
  if (!isSimpleMode.value) return
  form.higressMcpType = 'DIRECT_ROUTE'
  form.summary = form.summary || `${form.displayName || '该服务'}提供 MCP 工具能力。`
  form.description = form.description || form.summary
}

function fillForm(detail: McpDetailItem) {
  form.displayName = detail.displayName
  form.summary = detail.summary
  form.description = detail.description
  form.avatar = detail.avatar || DEFAULT_MCP_AVATAR
  form.category = detail.category || detail.newType || '综合类'
  form.tags = detail.tags?.length ? detail.tags : ['MCP 服务']
  form.visibilityMode = (detail.visibilityMode || 'private') as McpVisibilityMode
  form.userPermissions = [...(detail.userPermissions || [])]
  form.deptPermissions = [...(detail.deptPermissions || [])]
  if (form.userPermissions.length) {
    loadUserLabels(form.userPermissions)
  }
  if (form.deptPermissions.length && deptTree.value.length === 0) {
    fetchDepartments()
  }
  form.higressMcpType = (detail.higressMcpType || 'DIRECT_ROUTE') as HigressMcpType
  form.openApiInputMode = (detail.openApiInputMode || 'content') as OpenApiInputMode
  form.openApiContent = detail.openApiContent || ''
  form.openApiUrl = detail.openApiUrl || ''
  form.openApiAuthConfig = cloneOpenApiAuthConfig(detail.openApiAuthConfig)
  form.routePluginConfig = cloneRoutePluginConfig(detail.routePluginConfig)
  form.transport = detail.transport
  form.serviceSourceType = detail.serviceSourceType
  form.serviceSourceDomain = detail.serviceSourceDomain
  form.serviceSourcePort = detail.serviceSourcePort
  form.serviceSourceProtocol = detail.serviceSourceProtocol
  form.gatewayDomain = gatewayDomain
  form.gatewayPath = normalizeGatewayPathWithTransport(detail.gatewayPath || '/mcp', detail.transport)
  form.upstreamUrl = String(detail.upstreamUrl || '').trim()
    || (!detail.upstreamUrlMasked ? String(detail.upstreamUrlPlaceholder || '').trim() : '')
    || buildExistingUpstreamUrl(detail)
    || buildCurrentUpstreamUrl()
  const plugins = form.routePluginConfig
  connectionMode.value = form.higressMcpType === 'OPEN_API'
    || plugins.headerModify.enabled
    || plugins.transformer.enabled
    ? 'advanced'
    : 'simple'
  formRef.value?.clearValidate()

  if (!String(form.upstreamUrl || '').trim()) {
    nextTick(() => {
      if (!String(form.upstreamUrl || '').trim()) {
        form.upstreamUrl = buildCurrentUpstreamUrl()
      }
    })
  }
}

function applyDefaultFormState() {
  Object.assign(form, defaultFormState())
  formRef.value?.clearValidate()
}

function getSourceAwareNetworkPayload() {

  return {
    serviceSourceType: form.serviceSourceType,
    serviceSourceDomain: form.serviceSourceDomain,
    serviceSourcePort: Number(form.serviceSourcePort),
    serviceSourceProtocol: form.serviceSourceProtocol
  }
}

function normalizeCreatePayload(): CreateMcpPayload {
  const openApiContent = form.openApiInputMode === 'content' ? form.openApiContent : ''
  const openApiUrl = form.openApiInputMode === 'url' ? form.openApiUrl : ''
  return {
    ...form,
    avatar: String(form.avatar || DEFAULT_MCP_AVATAR).trim(),
    tags: form.tags.slice(0, 5),
    visibilityMode: form.visibilityMode,
    ...getPermissionPayload(),
    gatewayPath: normalizeGatewayPath(),
    openApiContent,
    openApiUrl,
    openApiAuthConfig: cloneOpenApiAuthConfig(form.openApiAuthConfig),
    ...getSourceAwareNetworkPayload(),
    routePluginConfig: cloneRoutePluginConfig(form.routePluginConfig),
    transport: form.transport as McpTransport
  }
}

function normalizeUpdatePayload(): UpdateMcpPayload {
  const openApiContent = form.openApiInputMode === 'content' ? form.openApiContent : ''
  const openApiUrl = form.openApiInputMode === 'url' ? form.openApiUrl : ''
  const payload: UpdateMcpPayload = {
    displayName: form.displayName,
    summary: form.summary,
    description: form.description,
    avatar: String(form.avatar || DEFAULT_MCP_AVATAR).trim(),
    category: form.category,
    tags: form.tags.slice(0, 5),
    visibilityMode: form.visibilityMode,
    ...getPermissionPayload(),
    higressMcpType: form.higressMcpType,
    openApiInputMode: form.openApiInputMode,
    openApiContent,
    openApiUrl,
    openApiAuthConfig: cloneOpenApiAuthConfig(form.openApiAuthConfig),
    transport: form.transport as McpTransport,
    ...getSourceAwareNetworkPayload(),
    gatewayDomain,
    gatewayPath: normalizeGatewayPath(),
    routePluginConfig: form.higressMcpType === 'DIRECT_ROUTE' ? cloneRoutePluginConfig(form.routePluginConfig) : undefined
  }

  if (form.upstreamUrl.trim()) {
    payload.upstreamUrl = form.upstreamUrl.trim()
  }

  return payload
}

async function submitForm() {
  if (!gatewayDomain) {
    ElMessage.error('请先配置 MCP 网关地址')
    return
  }
  applySimpleModeDefaults()
  await formRef.value?.validate()

  if (form.visibilityMode === 'restricted' && !hasRestrictedPermissionTarget()) {
    ElMessage.warning('请选择至少一个有权限的人员或部门')
    return
  }

  submitting.value = true

  try {
    if (isEditing.value) {
      const response: any = await mcpApi.updateMyService(serviceId.value, normalizeUpdatePayload())
      ElMessage.success('MCP 已更新，正在重新同步')
      router.push(`/mcp/server/${response.data.id}`)
      return
    }

    const response: any = await mcpApi.createMyService(normalizeCreatePayload())
    ElMessage.success('MCP 已创建，正在同步接入')
    router.push(`/mcp/server/${response.data.id}`)
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  if (isEditing.value) {
    loadDetail()
    return
  }
  applyDefaultFormState()
  connectionMode.value = 'simple'
  connectionPreview.value = null
}

async function loadDetail() {
  if (!isEditing.value) return
  loading.value = true

  try {
    const response: any = await mcpApi.getMyServiceDetail(serviceId.value)
    fillForm(response.data)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchDepartments()
  restoreSimpleDraft()
  loadDetail()
})

watch(
  () => [form.displayName, form.visibilityMode, form.transport, connectionMode.value],
  () => {
    if (isSimpleMode.value) saveSimpleDraft()
  }
)

watch(isOpenApiService, (isOpenApi) => {
  if (isOpenApi) connectionMode.value = 'advanced'
})

watch(
  () => form.visibilityMode,
  (visibilityMode) => {
    if (visibilityMode !== 'restricted') {
      form.userPermissions = []
      form.deptPermissions = []
    }
  }
)

watch(
  () => form.transport,
  (transport) => {
    form.gatewayPath = normalizeGatewayPathWithTransport(form.gatewayPath || '/mcp', transport)
  }
)

watch(
  () => [form.serviceSourceProtocol, form.serviceSourceDomain, form.serviceSourcePort, form.gatewayPath, form.transport, isEditing.value],
  () => {
    if (!isEditing.value || String(form.upstreamUrl || '').trim()) return
    const rebuiltUpstreamUrl = buildCurrentUpstreamUrl()
    if (rebuiltUpstreamUrl) {
      form.upstreamUrl = rebuiltUpstreamUrl
    }
  }
)

watch(
  () => route.params.id,
  async (nextId, previousId) => {
    if (nextId === previousId) return
    if (!nextId) {
      applyDefaultFormState()
      return
    }
    await loadDetail()
  }
)
</script>

<style scoped lang="scss">
.mcp-publish-page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(226, 237, 255, 0.92), transparent 32%),
    linear-gradient(180deg, #f5f9ff 0%, #eef4ff 100%);
}

.publish-main {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px;
}

.publish-hero {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 28px 0 30px;
}

.publish-hero__copy {
  display: grid;
  gap: 10px;
}

.eyebrow {
  margin: 0;
  color: #3968df;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  color: #172742;
  font-size: 34px;
  line-height: 1.18;
}

.publish-hero p:last-child {
  max-width: 760px;
  margin: 0;
  color: #61728e;
  line-height: 1.8;
}

.publish-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
}

.publish-form,
.publish-guide {
  display: grid;
  gap: 18px;
}

.connection-mode-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border: 1px solid #d8e5fb;
  border-radius: 20px;
  background: linear-gradient(135deg, #f9fbff 0%, #edf4ff 100%);
}

.connection-mode-panel h2,
.connection-mode-panel p {
  margin: 0;
}

.connection-mode-panel h2 {
  margin-top: 4px;
  color: #172742;
  font-size: 20px;
}

.connection-mode-panel > div > p:last-child {
  margin-top: 6px;
  color: #64758f;
  font-size: 13px;
  line-height: 1.65;
}

.simple-connect-fields {
  display: grid;
  gap: 18px;
}

.simple-connect-fields :deep(.el-form-item) {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: start;
  column-gap: 12px;
  margin-bottom: 0;
}

.simple-connect-fields :deep(.el-form-item__label) {
  width: auto !important;
  height: 32px;
  padding: 0;
  justify-content: flex-start !important;
  line-height: 32px;
}

.simple-connect-fields :deep(.el-form-item__content) {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin-left: 0 !important;
}

.simple-connect-fields :deep(.el-input),
.simple-connect-fields :deep(.el-select),
.simple-connect-fields :deep(.el-cascader) {
  width: 100%;
}

.simple-connect-fields :deep(.el-segmented) {
  justify-self: start;
}

.connection-preview-card {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  padding: 16px 18px;
  border: 1px solid #cfe0ff;
  border-radius: 16px;
  background: #f7faff;
}

.connection-preview-card--error {
  border-color: #f2d1d1;
  background: #fff8f8;
}

.connection-preview-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #1d2b44;
}

.connection-preview-card__head span,
.connection-preview-card > p,
.simple-draft-note {
  margin: 0;
  color: #64758f;
  font-size: 13px;
  line-height: 1.65;
}

.simple-connect-actions {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  gap: 16px;
  margin-top: 18px;
}

.simple-connect-transport {
  display: contents;
  color: #64758f;
  font-size: 13px;
}

.simple-connect-transport > span {
  grid-column: 1;
}

.simple-connect-transport :deep(.el-segmented) {
  grid-column: 2;
  justify-self: start;
}

.simple-connect-actions > :deep(.el-button) {
  grid-column: 3;
}

.simple-draft-note {
  margin-top: 12px;
}

.form-section,
.guide-card {
  border: 1px solid rgba(210, 223, 244, 0.95);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 40px rgba(32, 68, 145, 0.08);
}

.form-section {
  padding: 24px;
}

.section-head {
  display: flex;
  gap: 14px;
  margin-bottom: 20px;
}

.step-mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 14px;
  background: linear-gradient(160deg, #edf4ff 0%, #dbe8ff 100%);
  color: #315fe0;
  font-weight: 800;
}

.section-head h2,
.sub-section__head h3 {
  margin: 0;
  color: #172742;
}

.section-head p,
.sub-section__head p {
  margin: 8px 0 0;
  color: #64758f;
  line-height: 1.8;
}

.editor-panel {
  border-radius: 20px;
  background: linear-gradient(180deg, #fbfdff 0%, #f6f9ff 100%);
  padding: 8px 20px 0;
}

.editor-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  padding: 18px 0;
  border-bottom: 1px solid rgba(220, 230, 246, 0.9);
}

.editor-row--top {
  align-items: flex-start;
}

.editor-row--last {
  border-bottom: none;
}

.editor-label {
  color: #42536f;
  font-size: 14px;
  line-height: 22px;
  padding-top: 6px;
}

.editor-label.required::before {
  content: '*';
  color: #ff5f5f;
  margin-right: 4px;
}

.editor-field {
  margin-bottom: 0;
}

.editor-field--plain {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 100px;
}

.editor-field--stack {
  display: grid;
  gap: 8px;
}

.editor-field :deep(.el-select),
.editor-field :deep(.el-cascader) {
  width: 100%;
}

.editor-field__item {
  margin-bottom: 0;
}

.fixed-avatar-shell {
  flex-shrink: 0;
}

.avatar-image {
  width: 100px;
  height: 100px;
  border-radius: 16px;
  object-fit: cover;
  border: 1px solid rgba(210, 223, 244, 0.95);
  background: linear-gradient(160deg, #f8fbff 0%, #eef4ff 100%);
  box-shadow: 0 8px 22px rgba(32, 68, 145, 0.12);
}


.upload-copy {
  display: grid;
  gap: 6px;
  color: #6b7c97;
}

.upload-title {
  font-size: 14px;
  font-weight: 500;
}

.upload-subtitle,
.field-tip {
  font-size: 12px;
  color: #8a98af;
}

.field-tip--inline {
  margin-top: -4px;
}

.field-grid {
  display: grid;
  gap: 16px;
}

.field-grid.three {
  grid-template-columns: 240px 1fr 220px;
}

.field-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-grid.four {
  grid-template-columns: 170px minmax(260px, 1fr) 220px 170px;
}

.field-grid--network,
.field-grid--gateway {
  align-items: start;
}

:deep(.field-grid--network .el-form-item),
:deep(.field-grid--gateway .el-form-item) {
  display: grid;
  grid-template-rows: auto auto auto;
  align-content: start;
  margin-bottom: 0;
}

:deep(.field-grid--network .el-form-item__label),
:deep(.field-grid--gateway .el-form-item__label) {
  display: flex;
  justify-content: flex-start !important;
  width: 100% !important;
  height: auto;
  margin: 0 0 8px;
  padding: 0;
  line-height: 20px;
  text-align: left;
  white-space: normal;
}

:deep(.field-grid--network .el-form-item__content),
:deep(.field-grid--gateway .el-form-item__content) {
  display: grid;
  gap: 8px;
  width: 100%;
  min-width: 0;
  margin-left: 0 !important;
}

:deep(.field-grid--network .el-input),
:deep(.field-grid--network .el-select),
:deep(.field-grid--network .el-input-number),
:deep(.field-grid--gateway .el-input),
:deep(.field-grid--gateway .el-select),
:deep(.field-grid--gateway .el-input-number) {
  width: 100%;
}

.field-grid--network .field-tip,
.field-grid--gateway .field-tip {
  margin-top: 0;
  line-height: 1.6;
}


.sub-section {
  display: grid;
  gap: 16px;
  margin-top: 8px;
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, #fbfdff 0%, #f6f9ff 100%);
}

.sub-section + .sub-section {
  margin-top: 18px;
}

.route-plugin-panel {
  display: grid;
  gap: 14px;
}

.route-plugin-panel .sub-section__head.compact {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.route-plugin-panel .sub-section__head.compact > div {
  min-width: 0;
}

.route-plugin-panel .sub-section__head.compact :deep(.el-switch) {
  flex-shrink: 0;
  margin-top: 4px;
}

.plugin-card {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(214, 226, 244, 0.95);
  background: #ffffff;
}

.plugin-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-card__head strong {
  color: #1d2b44;
  font-size: 15px;
}

.plugin-card__actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.plugin-doc-button {
  padding: 0 2px;
  color: #5d78a3;
  font-size: 13px;
}

.route-preview {
  padding: 16px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid #e6eef9;
}

.route-preview span {
  display: block;
  margin-bottom: 8px;
  color: #6f8099;
  font-size: 13px;
}

.route-preview strong {
  display: block;
  color: #1d2b44;
  overflow-wrap: anywhere;
}

.route-preview p {
  margin: 10px 0 0;
  color: #62728c;
}

.submit-bar {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 0;
}

.publish-guide {
  align-self: start;
  position: sticky;
  top: 20px;
}

.guide-card {
  padding: 22px;
}

.preview-guide {
  display: grid;
  gap: 16px;
}

.mcp-card {
  position: relative;
  min-height: 240px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.mcp-card--preview {
  cursor: default;
}

.card-header {
  position: relative;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 30px;
}

.header-background {
  position: absolute;
  inset: 8px 10px;
  width: calc(100% - 20px);
  height: calc(100% - 16px);
  z-index: 0;
  border-radius: 8px 8px 0 0;
  background-size: cover;
  background-position: center;
}

.header-background.bg-variant-0 { background-image: url('/app_bj1.png'); }

.app-name-wrapper {
  position: relative;
  z-index: 1;
  display: inline-flex;
  max-width: calc(100% - 120px);
  min-width: 0;
  margin-right: 12px;
  flex-direction: column;
  border-radius: 8px;
  padding: 6px 0;
  backdrop-filter: blur(10px);
}

.app-name {
  margin: 0;
  overflow: hidden;
  color: #ffffff;
  font-family: var(--font-alimama);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creator-badge {
  width: max-content;
  max-width: 100%;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  color: #3b66d6;
  font-size: 14px;
  font-weight: 600;
  padding: 2px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-avatar {
  position: relative;
  z-index: 1;
  height: 90px;
  flex-shrink: 0;
}

.mcp-icon {
  width: 90px;
  height: 90px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.3);
  object-fit: cover;
}

.card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  background: #ffffff;
}

.card-app-name {
  margin: 0 0 2px;
  overflow: hidden;
  color: #303133;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.tag-0 { background-color: #e6f0ff; color: #3b66d6; }
.tag-1 { background-color: #e8fff2; color: #17b76a; }
.tag-2 { background-color: #fff4e6; color: #ff9b3b; }
.tag-3 { background-color: #f7f8fc; color: #909399; }

.card-description {
  margin: 0;
  overflow: hidden;
  color: #888f99;
  display: -webkit-box;
  font-size: 13px;
  line-height: 16px;
  text-overflow: ellipsis;
  word-break: break-all;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  background-color: transparent;
}

.stats-left {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  flex: 0 0 auto;
}

.stat-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  color: #999999;
  font-size: 12px;
  line-height: 1.4;
}

.stat-icon {
  width: 13px;
  height: 13px;
}

.card-hover-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05));
}

:deep(.editor-field .el-form-item__content),
:deep(.editor-field__item .el-form-item__content) {
  width: 100%;
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-input-number .el-input__inner) {
  text-align: left;
}

@media (max-width: 1180px) {
  .publish-layout,
  .field-grid.three,
  .field-grid.four {
    grid-template-columns: 1fr;
  }

  .publish-guide {
    position: static;
  }
}

@media (max-width: 760px) {
  .publish-main {
    padding: 18px;
  }

  .editor-row {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px 0;
  }

  .editor-field--plain {
    flex-direction: column;
    align-items: flex-start;
  }

  .mcp-card--preview .card-header {
    height: 112px;
    flex-direction: row;
    align-items: center;
    padding: 14px 24px;
  }

  .mcp-card--preview .app-name-wrapper {
    max-width: calc(100% - 92px);
  }

  .mcp-card--preview .card-avatar {
    height: 68px;
  }

  .mcp-card--preview .mcp-icon {
    width: 68px;
    height: 68px;
  }

  .submit-bar {
    flex-direction: column;
  }

  .connection-mode-panel {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .publish-main {
    padding: 12px;
  }

  .publish-hero {
    padding: 18px 0 20px;
  }

  h1 {
    font-size: 26px;
  }

  .form-section,
  .guide-card {
    border-radius: 16px;
  }

  .form-section {
    padding: 16px;
  }

  .guide-card {
    padding: 16px;
  }

  .mcp-card--preview {
    min-height: 220px;
  }

  .mcp-card--preview .card-header {
    height: 104px;
    padding: 12px 18px;
  }

  .mcp-card--preview .app-name {
    font-size: 20px;
  }

  .mcp-card--preview .creator-badge {
    font-size: 12px;
  }

  .mcp-card--preview .app-name-wrapper {
    max-width: calc(100% - 76px);
  }

  .mcp-card--preview .card-avatar {
    height: 56px;
  }

  .mcp-card--preview .mcp-icon {
    width: 56px;
    height: 56px;
  }

  .section-head {
    gap: 10px;
  }

  .step-mark {
    width: 36px;
    height: 36px;
    border-radius: 12px;
  }

  .editor-panel {
    padding: 4px 14px 0;
  }

  .field-grid.two {
    grid-template-columns: 1fr;
  }

  .field-grid.three,
  .field-grid.four {
    grid-template-columns: 1fr;
  }

  .sub-section {
    padding: 16px;
  }

  .connection-mode-panel {
    padding: 16px;
    border-radius: 16px;
  }

  .connection-mode-panel :deep(.el-segmented) {
    width: 100%;
  }

  .connection-mode-panel :deep(.el-segmented__item) {
    flex: 1;
  }

  .connection-preview-card {
    padding: 14px;
  }

  .connection-preview-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .simple-connect-fields :deep(.el-form-item) {
    grid-template-columns: 1fr;
    row-gap: 8px;
  }

  .simple-connect-fields :deep(.el-form-item__label),
  .simple-connect-fields :deep(.el-form-item__content) {
    grid-column: 1;
  }

  .simple-connect-fields :deep(.el-segmented) {
    width: 100%;
  }

  .simple-connect-fields :deep(.el-segmented__item) {
    flex: 1;
  }

  .simple-connect-actions {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .simple-connect-transport {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .simple-connect-transport > span,
  .simple-connect-transport :deep(.el-segmented),
  .simple-connect-actions > :deep(.el-button) {
    grid-column: 1;
    width: 100%;
  }

  .route-plugin-panel .sub-section__head.compact {
    flex-direction: column;
    gap: 10px;
  }

  .route-plugin-panel .sub-section__head.compact :deep(.el-switch) {
    margin-top: 0;
  }

  .plugin-card {
    padding: 14px;
  }

  .plugin-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .plugin-card__actions {
    width: 100%;
    justify-content: space-between;
  }

  .route-preview {
    padding: 14px;
  }

  .submit-bar :deep(.el-button) {
    width: 100%;
  }
}
</style>
