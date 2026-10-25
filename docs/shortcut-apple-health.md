# 用快捷指令把 Apple Health 的打球 / 二区记录导进 App

网页 App 读不了 Apple Health，所以分两步：手机上跑一次快捷指令生成一个文本文件，再在 App 的"设置 → 导入 Apple Health 运动记录"里选这个文件。每次想同步就重复这两步，重复的记录会被自动跳过。

## 文件格式

快捷指令每次体能训练写一行，用 `|` 分开四段：类型、开始时间、结束时间、平均心率（可以空）。

```
Badminton|2026-10-24T19:00:00-07:00|2026-10-24T20:05:00-07:00|135
Outdoor Walk|2026-10-25T08:10:00-07:00|2026-10-25T08:45:00-07:00|128
```

App 导入时：Badminton / 羽毛球默认记为打球；Cycling、Elliptical、Rowing 等记为二区；Walking / Hiking 按平均心率猜，115–145 之间记为二区，否则记为散步。每条都能在预览里改，也能跳过。

## 搭建步骤（英文系统，iOS 17 / 18）

1. Open **Shortcuts**, tap **+** to create a new shortcut, name it "Export Workouts".
2. Add **Find Workouts** (Health).
   - Add a filter: **Start Date** · **is in the last** · **30 days** (bigger if you want more history).
   - Sort by **Start Date**, Order **Latest First**. Leave Limit off.
3. Add **Repeat with Each**, input = **Workouts** (the result of step 2). Steps 4–8 go inside this Repeat block.
4. Add **Get Details of Workouts**: input **Repeat Item**, Detail **Start Date**. Then add **Format Date**: Date Format **ISO 8601**, turn on **Include ISO 8601 Time**. Add **Set Variable** → name it `start`.
5. Same again for **End Date** → Format Date (ISO 8601 + time) → Set Variable `end`.
6. Add **Get Details of Workouts**: Detail **Workout Type** → Set Variable `type`.
7. Average heart rate: add **Find Health Samples**, Type **Heart Rate**, two filters: **Start Date is after** `start`, **Start Date is before** `end`. Then add **Calculate Statistics**: Operation **Average**, input = the health samples. Set Variable `hr`. (Slowest step. If it errors or you don't need heart rate, delete this whole step and leave the field empty.)
8. Add **Text** with one line: `type|start|end|hr` — insert the four variables (tap the variable names above the keyboard). Then **Add to Variable** `lines`.
9. After the Repeat block ends, add **Combine Text**: input `lines`, Separator **New Lines**.
10. Add **Save File**: Service **iCloud Drive**, turn off **Ask Where to Save**, Destination Path `/Shortcuts/workouts.txt`, turn on **Overwrite If File Exists**.
11. Run it once. It will ask for Health permissions several times — allow all. Afterwards the file is in **Files → iCloud Drive → Shortcuts → workouts.txt**.

## 搭建步骤（中文系统）

动作名对照：Find Workouts = 查找体能训练，Repeat with Each = 重复每个项目，Get Details of Workouts = 获取体能训练的详细信息，Format Date = 格式化日期，Set Variable = 设定变量，Find Health Samples = 查找健康样本，Calculate Statistics = 计算统计，Text = 文本，Add to Variable = 添加到变量，Combine Text = 合并文本，Save File = 存储文件。其余步骤完全一样。

## 导入

App 首页底部 → 设置 → 数据 → **导入 Apple Health 运动记录** → 选 `workouts.txt`。预览里每条可以改"记为"，确认后入库。已导入过的和当天已手动记过同类的，默认跳过。

## 常见问题

- 找不到 Find Workouts：在动作搜索框搜 "workout"。
- 心率为空或报错：那次训练没戴表、没有心率样本，导入时心率留空即可。
- 导入提示"时间读不出来"：第 4、5 步的 Format Date 没选 ISO 8601，或没打开 Include ISO 8601 Time。
- 类型猜错或落到"跳过"：在预览的下拉里手动改。英文系统给的类型名是 Badminton、Walking、Outdoor Walk、Cycling、Elliptical 这类，App 都认。
- Zone 3 以上的分钟数 Apple Health 不直接存，导入后留空，需要的话手填。
