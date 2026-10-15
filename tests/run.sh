#!/bin/bash
# learn 脚本回归测试：每个场景用独立的临时 LEARN_HOME，不碰真实学习档案。
# 用法：bash tests/run.sh [learn.mjs 路径]（缺省为本仓库的 bin/learn.mjs）
# 依赖：node、git
P="${1:-$(cd "$(dirname "$0")/.." && pwd)/bin/learn.mjs}"
PASS=0; FAILN=0
L() { node "$P" "$@" 2>&1; }
ok() { PASS=$((PASS+1)); }
bad() { FAILN=$((FAILN+1)); echo "  ✗ [$T] $1"; echo "$2" | sed 's/^/      | /' | head -${3:-12}; }
has() { if printf '%s' "$2" | grep -qF -- "$1"; then ok; else bad "缺少: $1" "$2"; fi; }
hasnt() { if printf '%s' "$2" | grep -qF -- "$1"; then bad "不该有: $1" "$2"; else ok; fi; }
fresh() { export LEARN_HOME=$(mktemp -d)/learning; T="$1"; }
J() { node -e "const s=require(process.env.LEARN_HOME+'/'+process.argv[1]+'/state.json');console.log(JSON.stringify(eval(process.argv[2])))" "$@"; }
PJ() { node -e "const p=require(process.env.LEARN_HOME+'/profile.json');console.log(JSON.stringify(eval(process.argv[1])))" "$@"; }
TODAY=$(date +%F)

# ---------- T1 完整立课流程 ----------
fresh T1
D=$(mktemp -d); echo '<project><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></project>' > $D/pom.xml
L init sb --title "Spring Boot 入门" >/dev/null
o=$(L set-goal --json '{"exam":"能写 REST 接口并解释分层","profileSkill":"Spring Boot REST 开发"}'); has "learn-intake 第 3 步" "$o"
o=$(L cues --dir $D); has "Spring Boot ← pom.xml（文件里提到它）" "$o"; has "Java ← pom.xml" "$o"
o=$(L set-plan --json '[{"id":1,"title":"a"}]'); has "还没做先修问答" "$o"
o=$(L prereq set --json '[{"name":"Java","role":"core","reason":"写控制器"},{"name":"SQL","role":"general","reason":"写查询"},{"name":"Express","role":"related","reason":"路由可类比","cue":"package.json"}]'); has "下一步：问「Java」会不会（已问 0/4 题）" "$o"
o=$(L status); has "状态：还没出计划。下一步：先修问答还没完（learn-intake 第 3 步）" "$o"; c=$(printf '%s' "$o" | grep -c "下一步"); [ "$c" = 1 ] && ok || bad "status 里下一步不唯一($c)" "$o"
o=$(L prereq answer Java A); has "待出验证题" "$o"
o=$(L prereq quiz Java mastered --detail "预测 equals 与 == 输出并说出原因"); has "Java [必需] 写控制器 → 已会，不用补" "$o"
o=$(L prereq answer Express A); has "（看到 package.json 问的）" "$(PJ 'p.skills.map(s=>s.evidence.map(e=>e.detail)).flat()')"
o=$(L prereq quiz Express partial --detail "中间件顺序题答对，说不出原因"); has "Express [可类比] 路由可类比 → 可拿来打比方" "$o"
o=$(L prereq decide SQL learn-first); has "SQL [有帮助] 写查询 → 先补（加先修节）" "$o"
o=$(L prereq decide SQL inline); has "先修问答完成" "$o"
o=$(L prereq); has "SQL [有帮助] 写查询 → 边学边补" "$o"; has "先修问答完成。下一步：摸底（learn-intake 第 4 步）" "$o"
o=$(L baseline --json '[{"ability":"控制器","level":"none","evidence":"第1题不知道"}]'); has "下一步：出计划（learn-plan）" "$o"
o=$(L set-plan --json '[{"id":1,"title":"控制器","uses":["SQL"]},{"id":2,"title":"分层","requires":[1]}]'); has "下一节：第 1 节「控制器」" "$o"
o=$(L status); has "边学边补的先修：SQL（第 1 节要用）" "$o"; has "可类比（用户会的技能）：" "$o"
o=$(L start 1 --method worked-example --criteria "能写出 GET 接口" --check "费曼+1题" --steps '["示范","练习","检验"]'); has "本节先补先修「SQL」" "$o"; has "〔用你会的 X 打个比方〕" "$o"; has "本节达标标准：能写出 GET 接口；检验方式：费曼+1题" "$o"
o=$(L status); has "〔用你会的 X 打个比方〕" "$o"; has "本节达标标准：能写出 GET 接口" "$o"
o=$(L step 1 1 --result ok); has "第 2/3 步" "$o"
o=$(L done 1 --pass --note ok); has "下一节：第 2 节" "$o"

# ---------- T2 profile add 同一门课第二次纠正 ----------
fresh T2; L init c1 >/dev/null
L profile verify Java mastered --detail "预测 equals 输出并解释" >/dev/null
L profile add Java partial --quote "其实我只会一点" >/dev/null
L profile verify Java mastered --detail "第二题 HashMap 遍历顺序" >/dev/null
o=$(L profile add Java none --quote "其实我完全不会"); has "e4（自述：不会），现在算不会" "$o"

# ---------- T3 证据满 8 条 ----------
fresh T3; L init c1 >/dev/null
for i in 1 2 3 4 5 6 7 8; do L profile verify Go mastered --detail "第${i}题 goroutine 输出预测" >/dev/null; done
o=$(L profile add Go none --quote "其实我不会 Go"); has "e9（自述：不会），现在算不会" "$o"
o=$(L profile); has "e9 自述" "$o"; hasnt "e1 题目验证" "$o"
o=$(L profile forget e9); has "已删除 e9" "$o"

# ---------- T4 画像条目缺字段 ----------
fresh T4; L init c1 >/dev/null; L profile verify Java mastered --detail q1 >/dev/null; L profile verify SQL partial --detail q2 >/dev/null
node -e "const f=process.env.LEARN_HOME+'/profile.json';const p=require(f);delete p.skills[0].evidence[0].at;require('fs').writeFileSync(f,JSON.stringify(p))"
o=$(L profile); has "已用上一个版本（profile.json.bak）恢复" "$o"; hasnt "TypeError" "$o"
echo '{"version":1,"enabled":true,"seq":{"s":1,"e":0},"skills":[{"id":"s1","name":"Java"}]}' > $LEARN_HOME/profile.json; rm -f $LEARN_HOME/profile.json.bak
o=$(L status); hasnt "TypeError" "$o"; o=$(L profile); hasnt "TypeError" "$o"; has "本次按空画像处理" "$o"

# ---------- T5 暂停后清空仍暂停 ----------
fresh T5; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L profile verify Java mastered --detail q1 >/dev/null
L profile off >/dev/null
o=$(L profile reset --confirm yes); has "画像仍是暂停状态" "$o"
L prereq set --json '[{"name":"SQL","role":"general","reason":"查数据"}]' >/dev/null
o=$(L prereq answer SQL A); has "画像：已暂停，这次没有记入" "$o"

# ---------- T6 forget 清掉备份 ----------
fresh T6; L init c1 >/dev/null; L profile add Kubernetes partial --quote "只会 kubectl get" >/dev/null; L profile add Docker partial --quote "会 build" >/dev/null
L profile forget s1 >/dev/null
grep -q Kubernetes $LEARN_HOME/profile.json.bak && bad "备份里还有 Kubernetes" "" || ok
echo '{' > $LEARN_HOME/profile.json; o=$(L profile); hasnt "Kubernetes" "$o"; has "Docker" "$o"

# ---------- T7 有帮助项久未验证 → 重问 ----------
fresh T7; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L profile verify SQL mastered --detail "预测 LEFT JOIN 行数" >/dev/null
node -e "const f=process.env.LEARN_HOME+'/profile.json';const p=require(f);p.skills[0].evidence[0].at='2025-01-01';require('fs').writeFileSync(f,JSON.stringify(p))"
o=$(L prereq set --json '[{"name":"SQL","role":"general","reason":"查订单"}]'); has "SQL [有帮助] 查订单 → 待问会不会" "$o"; hasnt "先修问答完成" "$o"
L profile verify Redis partial --detail "缓存穿透题答对没说原因" >/dev/null
o=$(L prereq set --append --json '[{"name":"Redis","role":"general","reason":"缓存"}]'); has "Redis [有帮助] 缓存 → 够用，不用补" "$o"
o=$(L profile); has "2025-01-01" "$o"

# ---------- T8 checkText ----------
fresh T8; L init c1 >/dev/null
o=$(L profile verify Vue partial --detail "装 vue@3.4 后预测 ref 自动解包"); has "画像：已记入" "$o"
o=$(L profile verify Git partial --detail "解释 git clone git@github.com:a/b.git 的协议"); has "画像：已记入" "$o"
o=$(L profile verify Java partial --detail "问 finally 是否总是执行，答对没说原因"); has "画像：已记入" "$o"
o=$(L profile verify Java partial --detail "联系 zhang.san@example.com"); has "「zhang.san@example.com」像是邮箱" "$o"
o=$(L profile verify Java partial --detail "用户精通"); has "不能用：精通" "$o"

# ---------- T9 技能名 ----------
fresh T9; L init c1 >/dev/null
o=$(L profile add " " partial --quote x); has "不能为空" "$o"
o=$(L profile add "zhangsan@corp.com" none --quote x); has "像是邮箱" "$o"
L set-goal --json '{"exam":"x"}' >/dev/null
o=$(L prereq set --json '[{"name":".","role":"core","reason":"x"}]'); has "不能为空" "$o"
o=$(L set-goal --json '{"exam":"x","profileSkill":"13800138000"}'); has "像是邮箱、手机号" "$o"

# ---------- T10 cues ----------
fresh T10; L init c1 >/dev/null
D=$(mktemp -d); echo '{"publishConfig":{"tag":"next"},"keywords":["vue","react"],"devDependencies":{"eslint":"1","typescript":"5"}}' > $D/package.json
mkdir -p $D/__proto__ $D/constructor; touch $D/toString
printf 'project(x LANGUAGES CXX)\nadd_executable(a main.cpp)\n' > $D/CMakeLists.txt; touch $D/a.csproj
o=$(L cues --dir $D); hasnt "TypeError" "$o"; has "  JavaScript ← package.json" "$o"; has "  Node.js ← package.json" "$o"; has "TypeScript ← package.json（依赖里有它）" "$o"; hasnt "Vue" "$o"; hasnt "Next.js" "$o"; has "C++ ← CMakeLists.txt" "$o"; hasnt "  C ← " "$o"; has "C# ← a.csproj" "$o"
D2=$(mktemp -d); echo 'cmake_minimum_required(VERSION 3.10)' > $D2/CMakeLists.txt
o=$(L cues --dir $D2); has "C ← CMakeLists.txt（看不出是 C 还是 C++，分开问）" "$o"
o=$(L constructor); has "未知命令" "$o"

# ---------- T11 课中缺先修 → 先补 → 先修节排到前面 ----------
fresh T11; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none "入门课" >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B","requires":[1]},{"id":3,"title":"C","requires":[2]}]' >/dev/null
L start 1 --method coach --criteria x --steps '["a"]' >/dev/null; L done 1 --pass --note ok >/dev/null
L start 2 --method diagnose --criteria x --steps '["探测","纠偏","检验"]' >/dev/null; L step 2 1 --result ok >/dev/null
o=$(L prereq gap Docker --reason 要起容器); has "已记到第 2 节的 uses" "$o"
o=$(L prereq decide Docker learn-first); has "用没用过的新 id" "$o"
o=$(L set-plan --json '[{"id":1,"title":"A"},{"id":2,"kind":"prereq","prereqSkill":"Docker","title":"Docker 基础"},{"id":3,"title":"B"},{"id":4,"title":"C"}]'); has "第 2 节原来是「B」" "$o"
o=$(L plan); has '"uses":["Docker"]' "$o"; has "现在最大是 3" "$o"
o=$(L set-plan --json '[{"id":1,"title":"A"},{"id":4,"kind":"prereq","prereqSkill":"Docker","title":"Docker 基础"},{"id":2,"title":"B","requires":[1]},{"id":3,"title":"C","requires":[2]}]'); has "沿用原来的 uses：第 2 节（Docker）" "$o"; has "第 2 节先暂停" "$o"; has "下一节：第 4 节「Docker 基础」" "$o"
o=$(L now); has "📍 第 4 节「Docker 基础」（先修）" "$o"
o=$(L step 2 2 --result x); has "先 learn start 2" "$o"
o=$(L start 2); has "前置第 4 节「Docker 基础」还没掌握" "$o"
o=$(L start 4 --method worked-example --criteria x --steps '["a"]'); has "已开始" "$o"; hasnt "〔用你会的" "$o"
o=$(L done 4 --pass --note ok); has "画像：已记入「Docker」" "$o"; has "下一节：第 2 节" "$o"
o=$(L now); has "已暂停，做完 1/3 步" "$o"
o=$(L start 2 --steps '["x"]'); has "已做完 1/3 步，重新拆步骤会覆盖" "$o"
o=$(L start 2); has "第 2/3 步：纠偏" "$o"
o=$(L set-plan --json '[{"id":1,"title":"A"},{"id":4,"kind":"prereq","prereqSkill":"Docker","title":"Docker 基础"},{"id":2,"title":"B","requires":1}]'); has "requires 必须是节号" "$o"; hasnt "TypeError" "$o"

# ---------- T12 先单独学一门 ----------
fresh T12
L init sb >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"写控制器"}]' >/dev/null
L prereq answer Java C >/dev/null
o=$(L prereq decide Java separate); has "这门课在等先修「Java」" "$o"; has "--for sb:<技能>" "$o"; hasnt "摸底（learn-intake 第 4 步）" "$o"
o=$(L status); has "等待先修：Java" "$o"; has "状态：还没出计划。下一步：这门课在等先修" "$o"
o=$(L prereq decide Java known); has "画像里还没有「Java」验证过的记录" "$o"
o=$(L init jb --title "Java 基础" --for sb:Java); has "结业时会自动通知课程 sb" "$o"
L set-goal --json '{"exam":"y","profileSkill":"Java 基础语法"}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null; L start 1 --method coach --criteria x --steps '["a"]' >/dev/null; L done 1 --pass --note ok >/dev/null
o=$(L finish --pass --note ok); has "画像：已记入「Java 基础语法」" "$o"; has "画像：已记入「Java」" "$o"; has "sb（先修「Java」），已改为已会" "$o"
o=$(L use sb); hasnt "等待先修" "$o"; has "Java [必需] 写控制器 → 已会，不用补（已学完课程 jb）" "$(L prereq)"
# 手动出口
fresh T12b; L init k8s >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Docker","role":"core","reason":"打镜像"}]' >/dev/null; L prereq answer Docker C >/dev/null; L prereq decide Docker separate >/dev/null
L profile verify Docker mastered --detail "预测多阶段构建产物" >/dev/null
o=$(L prereq decide Docker known); has "Docker [必需] 打镜像 → 已会，不用补" "$o"; has "先修问答完成。下一步：摸底" "$o"

# ---------- T13 分批预算 + 一次上限 ----------
fresh T13; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"HTTP","role":"core","reason":"c"}]' >/dev/null
L prereq answer Java B >/dev/null; L prereq quiz Java partial --detail q >/dev/null; L prereq answer Maven B >/dev/null; L prereq quiz Maven partial --detail q >/dev/null
o=$(L prereq); has "HTTP [必需] c → 待定怎么补（推荐：边学边补）" "$o"
L prereq decide --all-recommended >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null; L set-plan --json '[{"id":1,"title":"A","uses":["Java"]}]' >/dev/null
o=$(L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"},{"name":"React","role":"related","reason":"可类比"}]'); has "下一步：问「Redis」会不会（已问 0/4 题）" "$o"
o=$(L status); has "（新阶段的先修）" "$o"
L prereq answer Redis C >/dev/null; L prereq answer React A >/dev/null
o=$(L prereq quiz React mastered --detail "hooks 题答对并解释"); has "React [可类比] 可类比 → 可拿来打比方" "$o"
o=$(L prereq decide Redis inline); has "按 learn-plan 排新阶段的节" "$o"

# ---------- T14 必需项最后一题选 A ----------
fresh T14; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"HTTP","role":"core","reason":"c"}]' >/dev/null
L prereq answer Java A >/dev/null; L prereq quiz Java mastered --detail q >/dev/null; L prereq answer Maven C >/dev/null
o=$(L prereq answer HTTP A); has "HTTP [必需] c → 待定怎么补（推荐：边学边补）" "$o"; has "自述能独立做，没来得及验证" "$o"

# ---------- T15 方法建议 ----------
fresh T15; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B"},{"id":3,"title":"C"},{"id":4,"title":"D"}]' >/dev/null
for i in 1 2 3; do L start $i --method first-principles --criteria x --steps '["a"]' >/dev/null; L done $i --pass --note ok >/dev/null; done
o=$(L status); hasnt "默认教法建议" "$o"
L init c2 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B"},{"id":3,"title":"C"},{"id":4,"title":"D"}]' >/dev/null
for i in 1 2 3; do L start $i --method coach --criteria x --steps '["a"]' >/dev/null; L done $i --pass --note ok >/dev/null; done
o=$(L status); has "默认教法建议：练习批改" "$o"
L profile off >/dev/null; o=$(L status); hasnt "默认教法建议" "$o"; has "也不给跨课程的教法建议" "$o"

# ---------- T16 错题复习 ----------
fresh T16; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null
L mistake 1 "以为 props 可改" "要发事件" --from vue >/dev/null
o=$(L review m1 --pass); has "还没到期" "$o"
o=$(L review m1 --fail); has "未通过" "$o"
node -e "const f=process.env.LEARN_HOME+'/c1/state.json';const s=require(f);s.mistakes[0].graduated=true;s.mistakes[0].due=null;require('fs').writeFileSync(f,JSON.stringify(s))"
o=$(L review m1 --pass); has "已移出错题本，不用再复习" "$o"
o=$(L review m1 --fail); has "未通过" "$o"; o=$(J c1 's.mistakes[0].graduated'); has "false" "$o"
L mistake 1 x y --from "Vue.js" >/dev/null; o=$(L mistake 1 z w --from "随便什么"); has "不在画像和先修清单里" "$o"
o=$(L profile); has "带着 vue 的习惯犯的错：2 条" "$o"

# ---------- T17 别的课程损坏的提示 ----------
fresh T17; L init a >/dev/null; L init b >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
echo '{broken' > $LEARN_HOME/a/state.json
o=$(L status); has "课程 a 的 state.json 已损坏" "$o"

# ---------- T18 先修问答中用 profile add ----------
fresh T18; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"}]' >/dev/null
o=$(L profile add Java mastered --quote "我会 Java"); has "正在先修问答里，用 learn prereq answer" "$o"

# ---------- T19 重定目标 + 摸底合并 ----------
fresh T19; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none x >/dev/null
L baseline --json '[{"ability":"a","level":"none","evidence":"x"},{"ability":"b","level":"partial","evidence":"y"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null
o=$(L set-goal --json '{"exam":"新目标"}'); has "已改目标" "$o"; has "prereq set --append" "$o"
o=$(L baseline --json '[{"ability":"b","level":"mastered","evidence":"z"},{"ability":"c","level":"none","evidence":"w"}]'); has "连同之前的共 3 项" "$o"

# ---------- T20 复习前置节 ----------
fresh T20; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"变量"},{"id":2,"title":"闭包","requires":[1]}]' >/dev/null
L start 1 --method coach --criteria x --steps '["a"]' >/dev/null; L done 1 --pass --note ok >/dev/null
L start 2 --method coach --criteria x --steps '["探测","练习"]' >/dev/null
o=$(L review --lesson 1 --reason "前置测试没过"); has "第 2 节先暂停" "$o"; has "📍 第 1 节「变量」 · 需复习" "$o"
o=$(L start 1); has "第 1 节是复习，要重新拆步骤" "$o"
o=$(L start 1 --steps '["复测"]'); has "第 1/1 步：复测" "$o"
# 换节时提示暂停 / 步骤都做完拒绝
L done 1 --pass --note ok >/dev/null; L start 2 >/dev/null; L step 2 1 --result ok >/dev/null; L step 2 2 --result ok >/dev/null
L set-plan --json '[{"id":1,"title":"变量"},{"id":2,"title":"闭包","requires":[1]},{"id":3,"title":"X"}]' >/dev/null
o=$(L start 3 --method coach --criteria x --steps '["a"]'); has "步骤都做完了还没检验" "$o"

# ---------- T23 检验没过后补练 / status 新行 ----------
fresh T23; L init c1 >/dev/null; L set-goal --json '{"exam":"x","minutesPerSession":45}' >/dev/null; L prereq set --none x >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B"}]' >/dev/null
L start 1 --method coach --criteria x --steps '["练","费曼检验"]' >/dev/null; L step 1 1 --result ok >/dev/null
o=$(L done 1 --fail --note "讲不清 X"); has "已追加 2 步：补练没过的那一项 → 重新检验" "$o"; has "第 3/4 步：补练没过的那一项" "$o"
o=$(J c1 's.lessons[0].steps[1]'); has '"status":"done"' "$o"; has '未达标：讲不清 X' "$o"
L mistake 1 "错A" "对A" >/dev/null
o=$(L status); has "（每次约 45 分钟，快到时收尾）" "$o"; has "本节上次检验（未通过）：讲不清 X" "$o"; has "本节记过的错：m1「错A」" "$o"
o=$(L done 1 --fail --note n --steps '["x"]'); has "还有没做完的步骤" "$o"
L step 1 3 --result r >/dev/null; L step 1 4 --result r >/dev/null
o=$(L done 1 --fail --note "还是不清" --steps '["补例子","费曼检验"]'); has "已追加 2 步：补例子 → 费曼检验" "$o"; has "连续 2 次未达标" "$o"
L step 1 5 --result r >/dev/null
o=$(L start 2 --method coach --criteria x --steps '["a"]'); has "已暂停" "$o"
L done 2 --pass --note ok2 >/dev/null; o=$(L status); has "已暂停，做完 5/6 步" "$o"; has "加载 skill teach-coach" "$o"; has "接着做：learn start 1，不带 --steps" "$o"
o=$(L start 1); has "第 6/6 步：费曼检验" "$o"
o=$(L done 1 --pass --note ok); o=$(L status); has "最近一次检验（第 1 节，通过）：ok" "$o"

# ---------- T21 老格式档案 ----------
fresh T21; L init old >/dev/null
node -e "const f=process.env.LEARN_HOME+'/old/state.json';const s=require(f);s.goal={exam:'x'};s.lessons=[{id:1,title:'A',requires:[],method:null,status:'todo',attempts:0,methodHistory:[],steps:[],notes:[]},{id:2,title:'B',requires:[1],method:null,status:'todo',attempts:0,methodHistory:[],steps:[],notes:[]}];require('fs').writeFileSync(f,JSON.stringify(s))"
o=$(L status); has "当前第 1 节「A」" "$o"; hasnt "TypeError" "$o"
o=$(L start 1 --method coach --criteria x --steps '["a"]'); has "已开始" "$o"
o=$(L done 1 --pass --note ok); has "下一节：第 2 节" "$o"
o=$(L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B","requires":[1]},{"id":3,"title":"C"}]'); has "计划已保存，共 3 节" "$o"
o=$(L plan); has '"id":3' "$o"
o=$(L prereq); has "建课时还没有先修问答这一步，不用补做" "$o"; hasnt "还没做先修问答" "$o"
o=$(L prereq set --append --json '[{"name":"SQL","role":"core","reason":"查数据"}]'); has "下一步：问「SQL」会不会" "$o"
o=$(L done 2 --fail --note "$(printf 'x%.0s' $(seq 1 200))"); hasnt "已追加" "$o"; o=$(L status); has "…" "$o"

# ---------- T22 gitignore / 画像不进 git ----------
o=$(cd $LEARN_HOME && git ls-files | grep -c profile); [ "$o" = 0 ] && ok || bad "画像进了 git" "$o"

echo "通过 $PASS 项，失败 $FAILN 项"
