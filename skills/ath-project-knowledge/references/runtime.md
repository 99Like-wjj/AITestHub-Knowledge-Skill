# 运行工具与集成（0.1.0）

运行代码通过注入的ToolPort调用宿主已配置官方MCP。原CallToolResult由共享协议ResultPort读取并执行安全检查，业务层只校验知识DTO；这里没有HTTP鉴权、Key管理、自动重试或模型调用。

本地适配器使用显式库外work目录保存一次任务的工作稿/来源、稳定localId、正式UUID映射、比较范围和原key状态。它不是项目知识权威库；JSON/MD是输入与任务工作稿。平台适配器注入WorkspacePort，复用同一业务流程，不把用户本地文件路径当平台可读资料。

每次本地保存使用revision和canonical digest CAS、独占锁、prepared日志和原子替换。中断先只读检查精确transactionId；只允许在原文件或已准备文件摘要一致时显式完成，不覆盖外部修改，不用恢复动作重新发MCP。

远端写/比较意图先本地持久，再唯一转dispatching后发送一次。未确定结果保留unknown，不自动重发；已发送意图只能只读核原状态。工作稿中的旧平台回执不是当前访问授权，重新引用内容需当前平台读取。

当前版本的发布/真实协议验收状态以包manifest和仓库README实施记录为准。缺共享边界或平台Web后半桥接时保持真实限制，不能以合成port通过宣称实际宿主已联通。宿主集成应提供真实ToolPort及共享ResultPort，秘密始终由宿主原MCP配置管理。

## 运行端口

包内`runtime/src/local.js`导出`createLocalAdapter({privateWorkRoot,protectedRoots?,tools,results})`；`runtime/src/platform.js`导出`createPlatformAdapter({workspace,tools,results})`，均返回`{workflow,store}`。本地集成方应将授权源码/安装目录传入protectedRoots，工作根必须是独立的显式库外任务目录；操作系统ACL由宿主管理。路径/锁检查不宣称能抵御拥有本机写权限的恶意并发进程。

`ToolPort.callTool(name,args)`返回官方原CallToolResult；`ResultPort.read(raw)`由共享层读出业务data或抛分类失败，`assertSafe(value)`进行结构/已知秘密检查。这里没有自定义协议包装。官方契约来自包内固定快照，仅结构检查，不替代服务端当前权限或refine。

业务方法：`listIndex(projectId,input)`每次只读一页；`getContent(projectId,entryId,revisionId?)`仅明确正文；`prepareComparison(store,snapshot,{localIds,remoteEntryIds?})`保存精确意图；`dispatchComparison(store,snapshot,intentId)`最多发一次；`recoverComparison(...)`只读原key；`getComparison(projectId,id)`只取原比较。`readSelectionPage(store,snapshot,comparisonId,{limit?,afterSelectionId?})`一次读取并采用一页真实选择收据，返回`{snapshot,page:{data,raw}}`并持久保存该页hasMore/nextCursor；不自动读取全部。无需Web key。`readSelectionByOriginalKey(...,key)`是已知原key的补充恢复路径，先重查当前比较权限，再读取原提交回执。

`store.create(projectId,spaceId)`产生独立workId；`store.read(workId)`返回`{work,digest}`；`store.update(workId,expectedDigest,mutate)`在锁内CAS。`addSource(work,source)`登记来源，`putDraft(work,draft)`明确新增/替换同localId提案，替换不暗改平台。source.disclosure/permissionNote和basis只是任务记载，不能mint授权或确认正确性。

`store.inspectRecovery(workId)`不写；`recover(workId,transactionId,currentDigest)`只完成精确已准备事务。死进程锁必须先`inspectLock`，再按精确lockId显式`releaseAbandonedLock`；活进程锁不强解。它们均不发送MCP。

## 纯本地命令

`node scripts/work.mjs <command> --workspace <显式绝对任务目录> ...`仅管理库外工作稿，不发HTTP/MCP/模型。源码目录运行前先`pnpm build`，包内运行时已自包含。

| command | 其他必需参数 |
| --- | --- |
| create | --project-id UUID --space-id UUID |
| summary / inspect-recovery / inspect-lock | --work-id UUID |
| add-source / put-draft | --work-id UUID --expected-digest SHA256 --input-key 相对文件键 |
| recover | --work-id UUID --transaction-id UUID --expected-digest SHA256 |
| release-lock | --work-id UUID --lock-id UUID |

输入键只能在工作根内，单项≤1MiB，使用包导出的canonical函数生成JSON；重复属性/不规范外部编辑拒绝，不回显正文。summary只回身份、数量、摘要和意图状态。普通用户不需写JSON；AI可经注入API保存工作稿，人工取舍继续使用平台。旧库目录非空且无本工具标记会拒绝初始化，不删除或自动迁移原文件。
