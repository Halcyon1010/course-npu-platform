# 课程 NPU 算力平台

学生使用课程账号登录，提交自己的模型和代码，每人同时最多申请 1 张 NPU 卡。平台负责任务排队、进度展示与结果交付，算力 TA 通过资源接口接入硬件。

本仓库是平台代码和接口变更的主仓库。当前交付为建设方案、资源接口 v0.1 和本地模拟服务。学生网站、账号系统、持久化调度器和真实 NPU 运行环境属于后续开发。

- [建设方案](docs/plan.md) 包含学生操作流程、单卡规则、系统分工、阶段验收和待确认项。
- [高峰期排队、资源调配与等待时间](docs/queue.md) 包含千人集中提交演练、学生端提示、TA 操作和上线压测标准。运行 `python queue_forecast.py` 可复现容量演练和不同作业时长下的等待区间。
- [资源接口 v0.1](docs/resource-api.md) 约定平台向算力侧派发作业、查询状态和取消作业的行为。
- [模拟服务](mock_provider.py) 仅依赖 Python 3.10+ 标准库，在本机运行，模拟资源占用和任务结束。

## 本地联调

在仓库根目录运行：

```shell
python mock_provider.py --cards 2 --seconds 10
```

另开终端运行下列命令。示例故意使用虚拟制品编号，模拟服务无需下载文件。

```powershell
$api = 'http://127.0.0.1:8090/v1'
Invoke-RestMethod "$api/capacity"
$body = @{ cards = 1; artifact_id = 'art-demo'; runtime = 'course-base' } | ConvertTo-Json
Invoke-RestMethod "$api/jobs/demo-01" -Method Put -ContentType application/json -Body $body
Invoke-RestMethod "$api/jobs/demo-01"
```

等待配置的运行时间后再次查询，可看到模拟作业结束、卡被回收。重新启动模拟服务会清空记录。执行 `python -m unittest -v` 可验证并发抢卡、幂等、取消和回收。
