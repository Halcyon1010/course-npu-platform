# 课程 NPU 算力平台

课程规划使用 64 张 910C。16 张供学生通过个人 SSH 账号共享调试，48 张供平台调度训练。每人同时最多一个训练任务，每个任务申请 1–4 张卡。

本仓库是平台代码和接口变更的主仓库。网站已提供默认英文的中英双语界面、学生登录、共享调试入口、多卡训练队列和模拟结果下载。使用 Node.js 22.13+ 在仓库根目录运行 `npm start` 启动网站，打开 http://127.0.0.1:8787。点击 **Sign in → Try a demo account** 可以体验。

- [网站运行与算力接入](docs/website.md) 包含课程账号开通、后台环境变量、SSH 和多卡训练接口。运行 `npm test` 验证主流程。

- [建设方案](docs/plan.md) 包含共享调试账号、进程巡检、训练配额、系统分工、阶段验收和待确认项。
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
