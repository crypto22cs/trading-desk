# nado-auto-desk

在 Ink 链上给 [Nado](https://nado.xyz) 中央限价簿挂单、再撤单的命令行工具。默认是纸面演练：只构造 EIP-712，不签名、不广播。

它不是交易台 monorepo 的分支，也没有网页控制台。配置、两个策略模板、花费上限和急停都在这个仓库里。

## 先读这一段

用多个钱包制造成交量，可能违反 Nado 的服务条款，也可能被当成虚假交易或女巫行为。`scheduled-place-cancel` 只是在**你自己的账户**上挂出一笔 post-only 限价单，停留一会儿再撤销。它不会安排钱包之间互相成交，也不要把它当成刷量工具。

请先在 Ink 测试网试通。主网是显式开关，而且花费上限默认很紧。合不合法、亏不亏钱，都由操作者自己负责。本工具不保证主网能直接用于生产。

## 环境

- Node.js 22 或更高
- pnpm 10（仓库锁的是 10.33）

订单走 Nado 网关的 `execute`，不是链上交易，所以挂撤本身不花 gas。子账户里仍然要先有抵押品，否则序列器会拒绝。充值、提现不在本工具里。

## 安装

```bash
pnpm install
pnpm test
pnpm run dry -- --strategy resting-maker
```

最后一条不需要私钥，也不会联网。它会打印一轮 `resting-maker` 的挂单和撤单计划，并写明「未广播」。

## 三种模式

| 模式 | 什么时候用 | 会不会发单 |
| --- | --- | --- |
| `paper` | 默认。检查配置、价格、名义和 EIP-712 | 永远不发。就算设了 `NADO_LIVE=1` 也不发，也不读私钥 |
| `testnet` | Ink 测试网，chainId **763373** | 只有 `NADO_LIVE=1` 才签名并提交 |
| `mainnet` | Ink 主网，chainId **57073** | 必须同时 `NADO_LIVE=1` 和 `NADO_CONFIRM_MAINNET=YES`，否则进程拒绝启动 |

纸面计划使用测试网的 chainId，这样和测试网实盘是同一套 EIP-712 域。委托的 `verifyingContract` 由产品号推导（BTC-PERP 是 `0x…0002`）。撤单的域用该网络的 Endpoint 合约。

网络常量来自 `@nadohq/client`，并与网关 `contracts` 查询核对过（2026-10-27）：

| | 测试网 | 主网 |
| --- | --- | --- |
| 网关 | `https://gateway.test.nado.xyz/v1` | `https://gateway.prod.nado.xyz/v1` |
| RPC（本工具挂撤用不到） | `https://rpc-gel-sepolia.inkonchain.com` | `https://rpc-gel.inkonchain.com` |
| Endpoint | `0x698D87105274292B5673367DEC81874Ce3633Ac2` | `0x05ec92D78ED421f3D3Ada77FFdE167106565974E` |

没有写 `caps` 时的默认上限：

| | 单笔名义 | 每小时名义 | 同时钱包数 |
| --- | --- | --- | --- |
| paper | 1000 USDT0 | 5000 | 4 |
| testnet | 1 000 000 | 5 000 000 | 8 |
| mainnet | **150** | **1000** | **1** |

超过上限的委托会被拒绝，不会悄悄把数量改小或改大。主网如果把单笔上限调到 150 以上，或同时跑多个钱包，启动时会警告，但仍然尊重你写在配置里的数字。

## 配置

复制 `.env.example` 为 `.env`。私钥、助记词、口令只放在环境变量或加密文件里，不要写进 YAML，也不要放在命令行参数里。

```bash
cp .env.example .env
```

纸面配置是 `config/paper.yaml`。测试网示例是 `config/testnet.example.yaml`，复制后再改：

```bash
cp config/testnet.example.yaml config/testnet.local.yaml
```

钱包三选一：

- `address`：纸面或不广播时用，只是一个地址
- `keyEnv`：环境变量名，值是 `0x` 加 64 位十六进制私钥
- `mnemonicEnv` + `path`：助记词变量名，路径例如 `m/44'/60'/0'/0/0`
- `keyFile`：`seal` 生成的加密文件

实盘时这三项密钥来源只能留一个。若同时写了 `address`，必须和私钥推导出的地址一致。

市场（产品号同样核对于 2026-10-27 的公开 `symbols`）：

| 符号 | productId | 价格跳动 | 数量步长 | 最小名义 |
| --- | --- | --- | --- | --- |
| BTC-PERP | 2 | 1 | 0.00005 | 100 USDT0 |
| ETH-PERP | 4 | 0.01 | 0.001 | 100 USDT0 |
| INK-USDT0 | 未挂牌 | — | — | 配置里 `enabled: false` |

公开列表里当时没有 `INK-USDT0`。核对到真实 `productId` 之前不要打开它。`productId: 0` 是报价资产，不能拿来下单。

价格有两种写法：

- `offset-bps`：相对参考价偏离多少个基点。买单向下，卖单向上，用来把 post-only 放在盘口外面。偏离超过 1900 基点会在本地拒绝，以免掉进预言机大约 ±20% 的带宽外。
- `absolute`：在一个最低价和最高价之间取样。

`fetchMark: true` 时，测试网和主网会向网关要中间价。失败就退回 `reference`。paper 永远用 `reference`，不联网。

调度：

- `once`：跑一轮
- `every`：`everyMs` 加上可选的 `jitterMs`。第一轮马上开始
- `cron`：五段 UTC 表达式，例如 `*/15 * * * *`。启动时不立刻打一枪，等到下一个整点

`maxOccurrences` 不写的话，`every` 和 `cron` 会一直跑到急停。模板里的预约策略默认只跑一轮。

花费按「尝试」计入滑动窗口：检查通过就占额度，后面提交失败也不退回，避免重试把同一小时打穿。

## 策略

### resting-maker

`strategies/resting-maker.yaml`

挂一笔 post-only 限价单，等待 `dwellMs`，再按订单 digest 撤销。用来确认签名和网关，不追求成交。默认不等待，委托的有效期是 5 分钟，撤不掉也会自己过期。

默认数量在 BTC 8 万附近大约是 120 USDT0，高于 100 的最小名义。本工具发现名义不够时会拒绝，不会把数量自动加大。

### scheduled-place-cancel

`strategies/scheduled-place-cancel.yaml`

同一套挂撤，按 `every` 或 `cron` 重复，间隔可以抖动。默认 `maxOccurrences: 1`，而且停留时间是 0。你确认过测试网行为之后，再把停留改成几秒到几十秒，并删掉 `maxOccurrences`，它才会循环到急停为止。

订单强制 post-only。不要把两个钱包的买卖价对到一起。

## 在测试网跑 resting-maker

1. 准备一个 Ink 测试网钱包，并在 Nado 测试网给 `default` 子账户存入抵押品。充值请用 Nado 自己的界面或水龙头。测试网抵押品是 6 位小数的 USDT0。
2. 把私钥放进 `.env`：

   ```bash
   NADO_PRIVATE_KEY=0x你的测试网私钥
   NADO_LIVE=1
   ```

3. 复制 `config/testnet.example.yaml`，确认 `keyEnv: NADO_PRIVATE_KEY`，花费上限你能接受。
4. 先不要开实盘，看计划：

   ```bash
   pnpm nado run --mode testnet --strategy resting-maker --config config/testnet.local.yaml
   ```

   `NADO_LIVE` 不是 `1` 时，这里仍然只打印计划。

5. 确认 `.env` 里 `NADO_LIVE=1` 之后再跑同一条命令。日志里会出现「已广播」和 digest。然后程序立刻撤单。
6. 想在界面上看见挂单，把策略里的 `dwellMs` 改成 `15000`，再跑一次。
7. 看状态：

   ```bash
   pnpm nado status --config config/testnet.local.yaml
   ```

换 ETH-PERP 时要同时加大数量。0.002 ETH 在两千多美元的价格下名义不够 100 USDT0，会被本地拒绝。大约 0.05 ETH 才过线，请按当时价格自己算。

主网：把 `mode` 改成 `mainnet`，收紧 `caps`（或删掉 `caps` 使用内置的 150 / 1000 / 并发 1），并同时设置：

```bash
NADO_LIVE=1
NADO_CONFIRM_MAINNET=YES
```

先用一个钱包、最小能过名义检查的尺寸。主网没有水龙头。

## 急停

正在跑的进程会在下一次提交前停下。已经挂出的那一笔仍会尝试撤销。

```bash
pnpm nado halt --reason "先停"
```

或者在前台按 Ctrl+C。再按一次会立刻退出，来不及撤单。

急停文件默认是 `.nado/HALT`。文件还在时，下一次 `run` 会拒绝启动。确认可以继续后删掉它：

```bash
rm .nado/HALT
```

## 加密私钥

口令和私钥都从环境变量或标准输入读，不从参数读。

```bash
NADO_KEY_PASSPHRASE='一长串口令' NADO_KEY_TO_SEAL='0x…' pnpm nado seal --out secrets/wallet1.json
```

配置里写 `keyFile: secrets/wallet1.json`。`secrets/` 已被 git 忽略。解密失败会直接报错，不会用空钥匙继续。

## 测试

```bash
pnpm test
pnpm run dry -- --strategy resting-maker
pnpm exec tsc --noEmit
```

单测覆盖取样、价格和数量对齐、花费窗口、急停文件，以及不联网的纸面挂撤。实盘路径用假的 HTTP 响应检查请求体里没有私钥。

## 不在范围内

- 充值、提现、子账户注册
- 市价单、IOC、FOK、只减仓、逐仓、自成交防护、条件单
- 钱包之间对敲
- Polymarket、Hyperliquid 或其他场地
- 保证主网策略赚钱或适合无人值守

## 目录

```
src/            命令、配置、EIP-712、网关、上限、急停
strategies/     两个策略模板
config/         paper 默认配置和测试网示例
test/           单测和纸面集成
```

命令入口是 `src/cli.ts`：`run`、`status`、`halt`、`seal`。
