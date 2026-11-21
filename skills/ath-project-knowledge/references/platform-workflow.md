# 平台工作流（0.1.1）

`ath_knowledge spaces/list-index/search`发现；`get`明确正文/修订；`history`查历史。分页明确剩余范围；当前子串搜索不是全量语义召回，索引不含正文不代表没有相关知识。

首次双方独立资料先列候选。localId稳定，正式entryId/修订从平台回执取得；名称/hash只提示候选。明确映射后仍检验共同基准。`ath_knowledge_changes compare`使用明确projectId/spaceId、manifest及平台范围，返回原comparison.id/digest/changeId；比较不写正式条目，但持久草案。

人通过平台逐项选择local/remote/merged，默认不覆盖；显式删除与恢复展示影响。提交只绑定原比较和选择。确认期间变化逐项冲突，独立成功项保留原回执；未选、平台独有、本地缺席或未加载后页均不删除。不自动合并，不依据新时间戳择胜者。

平台已提供`/#knowledge?projectId=...&comparisonId=...`原比较页，基址取宿主已配置平台，不猜其他地址。打开只读、不预选，不重新生成比较。人工使用平台逐项选择和明确提交；可靠宿主的原MRTR/本人Web确认规则不变，模型参数confirmed不授权。实际部署能力以当前读取为准；API JSON链接不能冒充Web人工页，缺接口时保留原比较，不另建来伪造接通。

人工提交后，`ath_knowledge_changes get-selection-receipts`按原projectId/comparisonId及input`{limit,afterSelectionId?}`读取本人当前有权的原收据，不需要知道Web commandId。默认20、最多50；只读当前页，hasMore/nextCursor明确保留，下一页由当前任务显式读取，不声称已读全部历史。已知原key时仍可用`ath_operation_status`；返回真实nested command，不能自行扁平化猜测。回执结果映射localId→changeId→entryId/revisionId，只更新真实成功项，冲突保留提案与旧基准，不按标题猜新建entryId。

恢复旧正文需当前rowVersion/baseRevisionId及sourceRevisionId，生成新修订且保留后来历史。当前已删除知识不用普通get绕读，历史/恢复走专门入口。撤Key影响该Key渠道，Web会话单独校验；成员撤权影响相应项目，两者不混同。
