/**
 * dsh-usage-analytics · 测试入口
 *
 * 不依赖 `node --test`（它在部分受限环境里会 spawn 子进程），
 * 直接把各测试文件 import 进同一个进程执行；node:test 自己会设置退出码。
 */
import '../test/pricing.test.mjs'
import '../test/scan.test.mjs'
import '../test/aggregate.test.mjs'
import '../test/store.test.mjs'
import '../test/sync.test.mjs'
import '../test/api.test.mjs'
