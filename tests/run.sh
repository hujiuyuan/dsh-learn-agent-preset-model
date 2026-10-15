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
o=$(L prereq set --json '[{"name":"Java","role":"core","reason":"写控制器"},{"name":"SQL","role":"general","reason":"写查询"},{"name":"Express","role":"related","reason":"路由可类比","cue":"package.json"}]'); has "下一步：用 1 次 ask_user_question 一起问下面 3 项会不会，每项一题（问会不会不占验证题名额）" "$o"; has "Express：本课用它路由可类比（看到 package.json 才问的，题面说出来）" "$o"; has "先修清单（3 项，本批验证题已出 0/4）" "$o"
o=$(L status); has "状态：还没出计划。下一步：先修问答还没完（learn-intake 第 3 步）" "$o"; c=$(printf '%s' "$o" | grep -c "下一步"); [ "$c" = 1 ] && ok || bad "status 里下一步不唯一($c)" "$o"
o=$(L prereq answer Java A); has "Java [必需] 写控制器 → 待出验证题" "$o"; has "下面 2 项还没记会不会。用户在刚才那次提问里已经答了的，直接记，不要再问" "$o"; hasnt "出 1 道验证题" "$o"
o=$(L prereq answer SQL C); has "SQL [有帮助] 写查询 → 待定怎么补" "$o"; has "下面 1 项还没记会不会" "$o"; has "  Express：本课用它" "$o"
o=$(L prereq answer Express A); has "（看到 package.json 问的）" "$(PJ 'p.skills.map(s=>s.evidence.map(e=>e.detail)).flat()')"; has "下一步：给「Java」出 1 道验证题（本批验证题已出 0/4）。一次只出这一题：ask_user_question 里只放这一题" "$o"; has "选择题选对了，先追问一句「为什么」再判" "$o"
o=$(L prereq quiz Java mastered --detail "预测 equals 与 == 输出并说出原因"); has "Java [必需] 写控制器 → 已会，不用补" "$o"; has "下一步：给「Express」出 1 道验证题（本批验证题已出 1/4）" "$o"
o=$(L prereq quiz Express partial --detail "中间件顺序题答对，说不出原因"); has "Express [可类比] 路由可类比 → 可拿来打比方" "$o"; has "先修清单（3 项，本批验证题已出 2/4）" "$o"
o=$(L prereq decide SQL learn-first); has "SQL [有帮助] 写查询 → 先补（加先修节）" "$o"
o=$(L prereq decide SQL inline); has "先修问答完成" "$o"
o=$(L prereq); has "SQL [有帮助] 写查询 → 边学边补" "$o"; has "先修问答完成。下一步：摸底（learn-intake 第 4 步）" "$o"
o=$(L baseline --json '[{"ability":"控制器","level":"none","evidence":"第1题不知道"}]'); has "下一步：出计划（learn-plan）" "$o"
o=$(L set-plan --json '[{"id":1,"title":"控制器","uses":["SQL"]},{"id":2,"title":"分层","requires":[1]}]'); has "下一节：第 1 节「控制器」" "$o"
o=$(L status); has "边学边补的先修：SQL（第 1 节要用）" "$o"; has "可类比（用户会的技能）：" "$o"
o=$(L start 1 --method worked-example --criteria "能写出 GET 接口" --check "费曼+1题" --steps '["示范","练习","检验"]'); has "本节先补先修「SQL」" "$o"; has "〔用你会的 X 打个比方〕" "$o"; has "本节达标标准：能写出 GET 接口；检验方式：费曼+1题" "$o"
o=$(L status); has "〔用你会的 X 打个比方〕" "$o"; has "问用户看懂没有；看懂了再出 1 道" "$o"; has "本节达标标准：能写出 GET 接口" "$o"
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
o=$(L prereq decide Java known); has "画像里「Java」最近一次验证没过、或还没有验证过的记录" "$o"
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

# ---------- T13 验证题名额：会不会不占名额，验证题按「必需 → 可类比 → 其余」分 4 个 ----------
fresh T13; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"HTTP","role":"core","reason":"c"},{"name":"React","role":"related","reason":"r1"},{"name":"Vue","role":"related","reason":"r2"}]' >/dev/null
for x in Java Maven HTTP React; do L prereq answer $x A >/dev/null; done
o=$(L prereq answer Vue A); has "先修清单（5 项，本批验证题已出 0/4）" "$o"; has "Vue [可类比] r2 → 不拿来打比方（自述能独立做，名额用完没验证）" "$o"; has "先用一句话告诉用户：本批验证题名额用完了，「Vue」没验证，这门课不拿它打比方" "$o"; has "下一步：给「Java」出 1 道验证题" "$o"
o=$(L prereq quiz Vue mastered --detail q); has "现在不需要出验证题" "$o"
o=$(L prereq quiz Java partial --detail q); has "下一步：给「React」出 1 道验证题（本批验证题已出 1/4）" "$o"
o=$(L prereq quiz React mastered --detail q); has "下一步：给「Maven」出 1 道验证题" "$o"
o=$(L prereq quiz Maven partial --detail q); has "下一步：给「HTTP」出 1 道验证题（本批验证题已出 3/4）" "$o"
o=$(L prereq quiz HTTP mastered --detail q); has "本批验证题已出 4/4" "$o"; has "HTTP [必需] c → 已会，不用补" "$o"; has "Java：推荐「边学边补」" "$o"
L prereq decide --all-recommended >/dev/null; L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null; L set-plan --json '[{"id":1,"title":"A","uses":["Java"]}]' >/dev/null
o=$(L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"},{"name":"Svelte","role":"related","reason":"可类比"}]'); has "一起问下面 2 项会不会" "$o"; has "本批验证题已出 0/4" "$o"
o=$(L status); has "（新阶段的先修）" "$o"
L prereq answer Redis C >/dev/null; L prereq answer Svelte A >/dev/null
o=$(L prereq quiz Svelte mastered --detail "hooks 题答对并解释"); has "Svelte [可类比] 可类比 → 可拿来打比方" "$o"
o=$(L prereq decide Redis inline); has "按 learn-plan 排新阶段的节" "$o"

# ---------- T14 同一批必需项超过 4 个：分不到名额的进「问怎么补」，不凭自述定成已会 ----------
fresh T14; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"HTTP","role":"core","reason":"c"}]' >/dev/null
o=$(L prereq set --append --json '[{"name":"SQL","role":"core","reason":"d"},{"name":"Git","role":"core","reason":"e"}]'); has "一起问下面 5 项会不会" "$o"
for x in Java Maven HTTP SQL; do L prereq answer $x A >/dev/null; done
o=$(L prereq answer Git A); has "Git [必需] e → 待定怎么补（推荐：边学边补）" "$o"; has "下一步：给「Java」出 1 道验证题" "$o"
for x in Java Maven HTTP; do L prereq quiz $x mastered --detail q >/dev/null; done
o=$(L prereq quiz SQL mastered --detail q); has "Git：推荐「边学边补」（自述能独立做，名额用完没验证）" "$o"
L profile verify Git mastered --detail "rebase 题答对并说清原因" >/dev/null; o=$(L prereq decide Git known); has "Git [必需] e → 已会" "$o"

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
o=$(L prereq set --append --json '[{"name":"SQL","role":"core","reason":"查数据"}]'); has "下一步：用 ask_user_question 问「SQL」会不会（问会不会不占验证题名额）" "$o"
o=$(L done 2 --fail --note "$(printf 'x%.0s' $(seq 1 200))"); hasnt "已追加" "$o"; o=$(L status); has "…" "$o"

# ---------- T26 先修问答边角：旧档案迁移、读时定掉、缺口不拦新批、名额顺序、告知用户、改成已会 ----------
# v0.3 档案正处在第 2 批：名额只算这一批
fresh T26
L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"React","role":"related","reason":"r"}]' >/dev/null
for x in Java Maven React; do L prereq answer $x A >/dev/null; done
for x in Java Maven React; do L prereq quiz $x mastered --detail q >/dev/null; done
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null; L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null
L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"},{"name":"Svelte","role":"related","reason":"可类比"}]' >/dev/null
L prereq answer Redis A >/dev/null
node -e "const f=process.env.LEARN_HOME+'/c1/state.json';const s=require(f);const p=s.prereq;delete p.qStart;delete p.batchNo;delete p.plannedBatch;p.batchStart=3;for(const x of p.items){delete x.batch;if(x.source==='intake')x.addedAt='2026-01-01T09:00:00+08:00'}require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
o=$(L prereq answer Svelte A); has "本批验证题已出 0/4" "$o"; has "Svelte [可类比] 可类比 → 待出验证题" "$o"; has "下一步：给「Redis」出 1 道验证题" "$o"
has "1" "$(J c1 's.prereq.batchNo')"; hasnt "batchStart" "$(cat $LEARN_HOME/c1/state.json)"
# 盘上还没按名额定过：读的时候定掉；status 不出 null，set-plan 不卡
node -e "const f=process.env.LEARN_HOME+'/c1/state.json';const s=require(f);s.prereq.quizSeq=s.prereq.qStart+4;require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
o=$(L status); hasnt "null" "$o"; has "先用一句话告诉用户：本批验证题名额用完了，「Svelte」没验证，这门课不拿它打比方" "$o"; has "「Redis」没验证，之后问怎么补时一起问" "$o"
o=$(L prereq decide Redis inline); has "按 learn-plan 排新阶段的节" "$o"
o=$(L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B","uses":["Redis"]}]'); hasnt "先修还有" "$o"; hasnt "错误" "$o"

# 课中缺口还没定时追加：开新的一批，名额重新算；gap 不改掉「新阶段」的提示
fresh T26
L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"}]' >/dev/null; L prereq answer Java A >/dev/null; L prereq quiz Java mastered --detail q >/dev/null
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null; L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null
L prereq gap Docker --reason "要起容器" >/dev/null
o=$(L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"}]'); has "本批验证题已出 0/4" "$o"
o=$(L prereq answer Redis C); has "用户在刚才的问题里已经选过的，直接记，不要再问" "$o"
L prereq gap Kafka --reason "要发消息" >/dev/null
L prereq decide Redis inline >/dev/null; L prereq decide Docker inline >/dev/null
o=$(L prereq decide Kafka inline); has "按 learn-plan 排新阶段的节" "$o"

# 同一批 4 个必需项、第 1 个可类比答 C：第 2 个可类比项拿到名额
fresh T26
L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"HTTP","role":"core","reason":"c"},{"name":"React","role":"related","reason":"r1"},{"name":"Vue","role":"related","reason":"r2"}]' >/dev/null
L prereq set --append --json '[{"name":"SQL","role":"core","reason":"d"}]' >/dev/null
for x in Java Maven HTTP SQL; do L prereq answer $x A >/dev/null; done; L prereq answer React C >/dev/null
o=$(L prereq answer Vue A); has "Vue [可类比] r2 → 待出验证题" "$o"; has "「SQL」没验证，之后问怎么补时一起问" "$o"
o=$(L prereq quiz Java mastered --detail q); has "下一步：给「Vue」出 1 道验证题" "$o"
# 名额用完的必需项，后来验证过会了：可以改成已会
o=$(L prereq decide SQL known); has "画像里「SQL」最近一次验证没过、或还没有验证过的记录" "$o"
L profile verify SQL mastered --detail "联表查询题答对并说清原因" >/dev/null
o=$(L prereq decide SQL known); has "SQL [必需] d → 已会" "$o"

# ---------- T24 多台电脑同步（本地裸仓库当同步仓库；SA/SB 是两台电脑） ----------
T=T24; SD=$(mktemp -d); git init -q --bare $SD/r.git
export LEARN_SYNC_FOREGROUND=1
SA() { LEARN_HOME=$SD/a node "$P" "$@" 2>&1; }
SB() { LEARN_HOME=$SD/b node "$P" "$@" 2>&1; }
off() { git -C $SD/$1 config url."$SD/none.git".insteadOf "$SD/r.git"; }
on() { git -C $SD/$1 config --unset url."$SD/none.git".insteadOf; }
SA init c1 --title 课一 >/dev/null; SA profile add Java partial --quote "会一点 Java" >/dev/null
o=$(git -C $SD/a ls-files profile.json); [ -z "$o" ] && ok || bad "没开同步时画像进了 git" "$o"
o=$(SA sync); has "还没连同步仓库" "$o"
o=$(SA sync --remote https://u:tok@github.com/x/y.git); has "不要带用户名、密码或 token" "$o"
o=$(SA sync --remote ssh://git@127.0.0.1:1/x/y.git); has "连不上同步仓库" "$o"; has "git ls-remote ssh://git@127.0.0.1:1/x/y.git" "$o"
o=$(SA sync --remote $SD/none.git); has "连不上同步仓库" "$o"; o=$(git -C $SD/a remote); [ -z "$o" ] && ok || bad "连不上还留着远程" "$o"
o=$(SA sync --remote $SD/r.git); has "这台电脑的进度和画像都推上去了（1 门课，画像 1 个技能）" "$o"
o=$(git -C $SD/r.git ls-tree -r --name-only HEAD); has "profile.json" "$o"; has "c1/state.json" "$o"; hasnt ".sync.json" "$o"
o=$(grep -cx profile.json $SD/a/.gitignore); [ "$o" = 0 ] && ok || bad "开了同步 .gitignore 还排除画像" "$(cat $SD/a/.gitignore)"
# 新电脑：拉下来
o=$(SB sync --remote $SD/r.git); has "把仓库里的进度和画像拉到了这台电脑（1 门课，画像 1 个技能）" "$o"
o=$(SB status); has "当前课程：c1「课一」" "$o"; [ "$(readlink $SD/b/.current)" = "$SD/b/c1" ] && ok || bad ".current 没指向 c1" "$(readlink $SD/b/.current)"
# B 记一笔，A 开场拉到
SB ask "B 的问题" >/dev/null
o=$(SA status); has "同步：拉到了" "$o"; has "B 的问题" "$(cat $SD/a/c1/log.md)"
# 离线：照常用本机进度；收尾当场说没推上去；联网后 sync 补推
off a
o=$(SA status); has "这次没连上同步仓库" "$o"; has "当前课程：c1" "$o"
o=$(SA pause --summary s --next n); has "同步：没推上去" "$o"
on a
o=$(SA sync); has "这台电脑和同步仓库已经一致" "$o"
SB status >/dev/null; SB ask "B 离开前问" >/dev/null
o=$(SB pause --summary s2 --next n2); has "同步：已推到同步仓库" "$o"; hasnt "同步冲突" "$o"
# 两边离线各学不同的课、各加画像：自动合在一起
off a
SA status >/dev/null; SA init c2 --title 课二 >/dev/null; SA profile add Rust partial --quote "Rust 会点" >/dev/null
on a
SB status >/dev/null; SB init c3 --title 课三 >/dev/null; SB profile add Go mastered --quote "Go 熟" >/dev/null
o=$(SA status); has "合在一起了" "$o"; hasnt "同步冲突" "$o"
o=$(SA list); has "c2「课二」" "$o"; has "c3「课三」" "$o"
o=$(SA profile); has "Rust" "$o"; has "Go" "$o"; has "Java" "$o"
o=$(node -e "const p=require('$SD/a/profile.json');const ids=p.skills.flatMap(s=>s.evidence.map(e=>e.id));console.log(ids.length===new Set(ids).size?'uniq':'dup')"); [ "$o" = uniq ] && ok || bad "合并后证据 id 重复" "$o"
o=$(SB status); has "同步：拉到了" "$o"; o=$(SB profile); has "Rust" "$o"
# 同一门课两边都改了：冲突，让用户选这门课留哪边；选「用这台的」后，另一台照常拉下来
off a; SA use c1 >/dev/null; SA ask "A 离线问" >/dev/null; on a
SB use c1 >/dev/null; SB ask "B 也问" >/dev/null
o=$(SA status); has "⚠ 同步冲突" "$o"; has "learn sync --keep remote" "$o"; has "learn sync --keep local" "$o"
o=$(SA ask "冲突中又问"); has "同步冲突还没解决" "$o"
o=$(SA sync --keep local); has "「课一」（c1）用这台电脑的，其他课程和画像两边的都留着" "$o"; has "backup/remote-" "$o"; hasnt "还没推上去" "$o"
o=$(SB status); has "同步：拉到了" "$o"; hasnt "同步冲突" "$o"; has "A 离线问" "$(cat $SD/b/c1/log.md)"; hasnt "B 也问" "$(cat $SD/b/c1/log.md)"
# 再冲突一次，这次选「用仓库里的」
off a; SA ask "A 再问" >/dev/null; on a
SB ask "B 再问" >/dev/null
o=$(SA sync); has "⚠ 同步冲突" "$o"
o=$(SA sync --keep remote); has "「课一」（c1）用同步仓库里的" "$o"; has "backup/local-" "$o"
o=$(SA status); hasnt "同步冲突" "$o"; has "B 再问" "$(cat $SD/a/c1/log.md)"; hasnt "A 再问" "$(cat $SD/a/c1/log.md)"; o=$(git -C $SD/a log --format=%s --branches='backup/local-*'); has "A 再问" "$o"
o=$(SA sync --keep remote); has "现在没有同步冲突" "$o"
o=$(SA profile forget e1); has "开了同步，两台电脑的记录合并时编号可能会变" "$o"
o=$(SA profile forget e1 --name Rust); has "e1 现在是「Java」的，不是「Rust」的" "$o"; has "「Rust」现在是 s" "$o"
o=$(SA profile forget e1 --name Java); has "同步仓库的历史记录里还留着" "$o"
# 第三台电脑自己已经学过别的课：连上时和仓库的合在一起
SC() { LEARN_HOME=$SD/c node "$P" "$@" 2>&1; }
SC init c7 --title 课七 >/dev/null
o=$(SC sync --remote $SD/r.git); has "原有的记录合在一起了" "$o"; o=$(SC list); has "c7「课七」" "$o"; has "c1「课一」" "$o"
# 不设 LEARN_SYNC_FOREGROUND：记录后在后台推
unset LEARN_SYNC_FOREGROUND
SB status >/dev/null; SB ask "后台推送" >/dev/null
for i in $(seq 1 50); do git -C $SD/r.git log -1 --format=%s | grep -q 后台推送 && break; sleep 0.1; done
o=$(git -C $SD/r.git log -1 --format=%s); has "后台推送" "$o"

# ---------- T25 同步边角：原有 origin、合并程序、各台当前课程、画像 id、暂停、按课程选边、合并中断、仓库重建、错仓库、没配身份、并发 ----------
T=T25; SD=$(mktemp -d); git init -q --bare $SD/r.git
export LEARN_SYNC_FOREGROUND=1
SA() { LEARN_HOME=$SD/a node "$P" "$@" 2>&1; }
SB() { LEARN_HOME=$SD/b node "$P" "$@" 2>&1; }
SC() { LEARN_HOME=$SD/c node "$P" "$@" 2>&1; }
PA() { node -e "const p=require('$SD/a/profile.json');console.log(JSON.stringify(eval(process.argv[1])))" "$1"; }
PB() { node -e "const p=require('$SD/b/profile.json');console.log(JSON.stringify(eval(process.argv[1])))" "$1"; }
# 数据目录里原来就有 origin（不是 learn sync 连的）：不同步
SA init c1 --title 课一 >/dev/null; git -C $SD/a remote add origin $SD/r.git
SA ask "q1" >/dev/null; SA profile add Java partial --quote "会点 Java" >/dev/null
o=$(git -C $SD/r.git rev-parse -q --verify HEAD); [ -z "$o" ] && ok || bad "没连同步却推了" "$o"
o=$(SA sync); has "还没连同步仓库" "$o"
o=$(git -C $SD/a ls-files profile.json); [ -z "$o" ] && ok || bad "没连同步画像进了 git" "$o"
# 连上；合并程序配上
o=$(SA sync --remote $SD/r.git); has "推上去了" "$o"
[ ! -e $SD/a/.gitattributes ] && ok || bad "不该再生成 .gitattributes" "$(cat $SD/a/.gitattributes)"
o=$(SB sync --remote $SD/r.git); has "拉到了这台电脑" "$o"
# 当前课程各台电脑自己记
SB init c2 --title 课二 >/dev/null
o=$(SA status); has "当前课程：c1" "$o"; has "c2" "$o"
o=$(SB status); has "当前课程：c2" "$o"
SA ask "A 又问" >/dev/null; o=$(SB status); has "当前课程：c2" "$o"; has "A 又问" "$(cat $SD/b/c1/log.md)"
# 画像：两边离线各记两条，合并后这台的 id 不变、没有重复
off a; off b
ra=$(SA profile add Rust partial --quote "Rust 会点" | grep -o '」e[0-9][0-9a-z]*' | grep -o 'e[0-9a-z]*')
ga=$(SA profile add Go mastered --quote "Go 熟" | grep -o '」e[0-9][0-9a-z]*' | grep -o 'e[0-9a-z]*')
[[ "$ra" =~ ^e[0-9]+[a-z]{3}$ ]] && ok || bad "开了同步后新 id 没带电脑标记" "$ra"
SB profile add Python partial --quote "Python 会点" >/dev/null; SB profile add Kotlin partial --quote "Kotlin 会点" >/dev/null
on b; SB status >/dev/null; on a
o=$(SA status); has "合在一起了" "$o"; hasnt "同步冲突" "$o"
o=$(PA 'p.skills.find(s=>s.name==="Rust").evidence[0].id'); [ "$o" = "\"$ra\"" ] && ok || bad "合并后这台的 id 变了（Rust 应为 $ra）" "$o"
o=$(PA 'p.skills.find(s=>s.name==="Go").evidence[0].id'); [ "$o" = "\"$ga\"" ] && ok || bad "合并后这台的 id 变了（Go 应为 $ga）" "$o"
o=$(PA 'p.skills.map(s=>s.name).sort().join(",")'); has "Go,Java,Kotlin,Python,Rust" "$o"
o=$(PA '(i=>i.length===new Set(i).size)(p.skills.flatMap(s=>s.evidence.map(e=>e.id)))'); [ "$o" = true ] && ok || bad "合并后证据 id 重复" "$(PA 'p.skills.flatMap(s=>s.evidence.map(e=>e.id))')"
o=$(PA '(i=>i.length===new Set(i).size)(p.skills.map(s=>s.id))'); [ "$o" = true ] && ok || bad "合并后技能 id 重复" "$o"
o=$(SB status); has "同步：拉到了" "$o"; o=$(PB 'p.skills.length'); [ "$o" = 5 ] && ok || bad "B 合并后技能数不对" "$o"
# 暂停：A 离线暂停，B 联网加一条；合并后两台都保持暂停
off a; SA profile off >/dev/null; SB profile add Swift partial --quote "Swift 会点" >/dev/null; on a
SA status >/dev/null; o=$(PA 'p.enabled'); [ "$o" = false ] && ok || bad "合并后暂停没了" "$o"
o=$(PA 'p.skills.some(s=>s.name==="Swift")'); [ "$o" = true ] && ok || bad "合并丢了 B 的新证据" "$o"
SB status >/dev/null; o=$(PB 'p.enabled'); [ "$o" = false ] && ok || bad "另一台没跟着暂停" "$o"
SA profile on >/dev/null; SB status >/dev/null
# 同一门课两边都改了：只这门课冲突；选「用仓库的」后，这台的新课程照样留着
off a; SA use c1 >/dev/null; SA ask "A-c1" >/dev/null; SA init c5 --title 课五 >/dev/null; on a
SB ask --c c1 "B-c1" >/dev/null; SB ask --c c2 "B-c2" >/dev/null
o=$(SA status); has "⚠ 同步冲突：「课一」（c1）" "$o"; has "其他课程和画像不用选，选完一起合并" "$o"; hasnt "「课二」" "$(printf '%s' "$o" | grep '同步冲突')"
o=$(SA sync --keep remote); has "「课一」（c1）用同步仓库里的" "$o"; has "backup/local-" "$o"
has "B-c1" "$(cat $SD/a/c1/log.md)"; hasnt "A-c1" "$(cat $SD/a/c1/log.md)"; has "B-c2" "$(cat $SD/a/c2/log.md)"
o=$(SA list); has "c5「课五」" "$o"; o=$(git -C $SD/r.git ls-tree -r --name-only HEAD); has "c5/state.json" "$o"
o=$(git -C $SD/a log --format=%s --branches='backup/local-*'); has "A-c1" "$o"
# 合并到一半被打断：下次运行先退回，再按冲突处理
off a; SA use c1 >/dev/null; SA ask "A-x" >/dev/null; on a; SB status >/dev/null; SB ask --c c1 "B-x" >/dev/null
git -C $SD/a fetch -q origin; GIT_EDITOR=true git -C $SD/a rebase -q '@{u}' >/dev/null 2>&1
[ -d $SD/a/.git/rebase-merge ] || [ -d $SD/a/.git/rebase-apply ] && ok || bad "没造出合并中断的状态" "$(git -C $SD/a status)"
o=$(SA status); has "学习记录之前停在 git 合并到一半的状态，已退回合并前的样子" "$o"; has "⚠ 同步冲突：「课一」（c1）" "$o"
o=$(SA sync --keep local); has "「课一」（c1）用这台电脑的" "$o"; hasnt "还没推上去" "$o"
o=$(git -C $SD/a status --porcelain); [ -z "$o" ] && ok || bad "选边后有没提交的改动" "$o"
# 仓库删了重建（空的）：把这台的全推上去
rm -rf $SD/r.git; git init -q --bare $SD/r.git
o=$(SA sync); has "这台电脑和同步仓库已经一致" "$o"; o=$(git -C $SD/r.git ls-tree -r --name-only HEAD); has "c5/state.json" "$o"; has "profile.json" "$o"
# 仓库里是别的东西：不连
git init -q $SD/w; echo hi > $SD/w/README; git -C $SD/w add README; git -C $SD/w commit -qm init; git clone -q --bare $SD/w $SD/w.git
SC init c9 >/dev/null
o=$(SC sync --remote $SD/w.git); has "不是学习记录" "$o"; o=$(git -C $SD/c remote); [ -z "$o" ] && ok || bad "错仓库还留着远程" "$o"
o=$(SC sync); has "还没连同步仓库" "$o"; o=$(git -C $SD/c ls-files profile.json .gitattributes); [ -z "$o" ] && ok || bad "没连上却改了 git 里的文件" "$o"
# 这台电脑的 git 没配用户名和邮箱：照样能提交
NI() { env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL -u EMAIL GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true LEARN_HOME=$SD/n node "$P" "$@" 2>&1; }
o=$(NI init c1); hasnt "没能提交" "$o"; o=$(git -C $SD/n log -1 --format=%an); [ "$o" = learn ] && ok || bad "没配身份时没提交上" "$o"
o=$(NI sync --remote $SD/r.git); has "已连上同步仓库" "$o"; hasnt "没推上去" "$o"
# 并发：几个窗口同时记，一条不丢；锁的主人已经退出时不卡
for i in 1 2 3 4 5 6; do LEARN_HOME=$SD/a node "$P" ask "并发$i" >/dev/null 2>&1 & done; wait
o=$(node -e "const s=require('$SD/a/c1/state.json');console.log(s.questions.filter(q=>q.text.startsWith('并发')).length)"); [ "$o" = 6 ] && ok || bad "并发记录丢了" "$o"
o=$(git -C $SD/a status --porcelain); [ -z "$o" ] && ok || bad "并发后有没提交的改动" "$o"
echo 999999 > $SD/a/.learn.lock; o=$(SA ask "陈旧锁"); hasnt "错误" "$o"; [ ! -e $SD/a/.learn.lock ] && ok || bad "锁没释放" ""
unset LEARN_SYNC_FOREGROUND

# ---------- T27 同步冲突名单列全、仓库重建时冲突自动解除、合并改号后按名字核对再删 ----------
T=T27; SD=$(mktemp -d); git init -q --bare $SD/r.git
export LEARN_SYNC_FOREGROUND=1
SA() { LEARN_HOME=$SD/a node "$P" "$@" 2>&1; }
SB() { LEARN_HOME=$SD/b node "$P" "$@" 2>&1; }
SA init c1 --title 课一 >/dev/null; SA init c2 --title 课二 >/dev/null; SA use c1 >/dev/null
SA sync --remote $SD/r.git >/dev/null; SB sync --remote $SD/r.git >/dev/null
# 两边离线都改了 c1、c2：两门都列出来
off a; SA ask --c c1 "A-c1" >/dev/null; SA ask --c c2 "A-c2" >/dev/null; on a
SB ask --c c1 "B-c1" >/dev/null; SB ask --c c2 "B-c2" >/dev/null
o=$(SA status); has "⚠ 同步冲突：「课一」（c1）、「课二」（c2）" "$o"; has "选完一起合并" "$o"
o=$(SA sync --keep local); has "「课一」（c1）、「课二」（c2）用这台电脑的" "$o"
has "A-c2" "$(cat $SD/a/c2/log.md)"; hasnt "B-c2" "$(cat $SD/a/c2/log.md)"
SB status >/dev/null; has "A-c2" "$(cat $SD/b/c2/log.md)"
# 报冲突时只有 c1；选之前这台又改了 c2：不动手，报新名单
off a; SA ask --c c1 "A2-c1" >/dev/null; on a
SB ask --c c1 "B2-c1" >/dev/null; SB ask --c c2 "B2-c2" >/dev/null
o=$(SA status); has "⚠ 同步冲突：「课一」（c1） 在" "$o"
SA ask --c c2 "A2-c2" >/dev/null
o=$(SA sync --keep remote); has "冲突的课程变了，这次没有改动任何记录" "$o"; has "「课一」（c1）、「课二」（c2）" "$o"
has "A2-c2" "$(cat $SD/a/c2/log.md)"; o=$(git -C $SD/a branch --list 'backup/*' | wc -l | tr -d ' '); [ "$o" = 1 ] && ok || bad "没选成却留了备份分支" "$(git -C $SD/a branch --list 'backup/*')"
o=$(SA sync --keep remote); has "「课一」（c1）、「课二」（c2）用同步仓库里的" "$o"
has "B2-c2" "$(cat $SD/a/c2/log.md)"; hasnt "A2-c2" "$(cat $SD/a/c2/log.md)"; o=$(git -C $SD/a log --format=%s --branches='backup/local-*'); has "A2-c2" "$o"
# 有冲突时仓库被删掉重建：冲突自动解除，把这台的推上去
off a; SA ask --c c1 "A3" >/dev/null; on a; SB status >/dev/null; SB ask --c c1 "B3" >/dev/null
o=$(SA status); has "⚠ 同步冲突" "$o"
rm -rf $SD/r.git; git init -q --bare $SD/r.git
o=$(SA status); hasnt "同步冲突" "$o"; o=$(SA ask "重建后"); hasnt "同步冲突还没解决" "$o"
o=$(git -C $SD/r.git log -1 --format=%s); has "重建后" "$o"
o=$(SA sync --keep remote); has "现在没有同步冲突" "$o"
# 开了同步后两台各记的 id 带各自的电脑标记，合并不改号，照回执删的就是那一条；名字对不上不删
SD2=$(mktemp -d); git init -q --bare $SD2/r.git
SX() { LEARN_HOME=$SD2/x node "$P" "$@" 2>&1; }
SY() { LEARN_HOME=$SD2/y node "$P" "$@" 2>&1; }
SX init c1 >/dev/null; SX profile add Java partial --quote "x" >/dev/null; SX sync --remote $SD2/r.git >/dev/null; SY sync --remote $SD2/r.git >/dev/null
git -C $SD2/x config url."$SD2/none.git".insteadOf "$SD2/r.git"; SX profile add Rust partial --quote "r" >/dev/null; git -C $SD2/x config --unset url."$SD2/none.git".insteadOf
o=$(SY profile add Python partial --quote "p"); py=$(printf '%s' "$o" | grep -o '」e[0-9][0-9a-z]*' | grep -o 'e[0-9a-z]*'); has "learn profile forget $py --name \"Python\"" "$o"
SX status >/dev/null; SY status >/dev/null
rs=$(node -e "const p=require('$SD2/y/profile.json');console.log(p.skills.find(s=>s.name==='Rust').evidence[0].id)"); [ "$rs" != "$py" ] && ok || bad "两台各记的 id 撞了" "$rs $py"
o=$(SY profile forget $rs --name "Python"); has "$rs 现在是「Rust」的，不是「Python」的" "$o"; has "「Python」现在是" "$o"; has "$py（自述：会一点" "$o"
o=$(SY profile); has "Rust" "$o"
o=$(SY profile forget $py --name "Python"); has "已删除 $py" "$o"
# 连同步之前各自记的（不带标记）撞了号：两条都换新号，旧号作废，按旧号删被拒、不会删错
SZ() { LEARN_HOME=$SD2/z node "$P" "$@" 2>&1; }
SZ init c9 >/dev/null; o=$(SZ profile add Kotlin partial --quote "k"); has "「Kotlin」e1" "$o"
o=$(SZ sync --remote $SD2/r.git); has "合在一起了" "$o"
o=$(node -e "const p=require('$SD2/z/profile.json');const ids=p.skills.flatMap(s=>s.evidence.map(e=>e.id));console.log(ids.includes('e1'), ids.length===new Set(ids).size)"); [ "$o" = "false true" ] && ok || bad "撞号后旧号还在或有重复" "$o"
o=$(SZ profile forget e1 --name "Kotlin"); has "e1 已经不存在" "$o"; has "「Kotlin」现在是" "$o"
unset LEARN_SYNC_FOREGROUND

# ---------- T28 第二轮复查：重建仓库不误报、长历史、选边后课程信息、暂停、裁证据、重连失败、错仓库、锁、先修 ----------
T=T28; SD=$(mktemp -d); git init -q --bare $SD/r.git
export LEARN_SYNC_FOREGROUND=1
SA() { LEARN_HOME=$SD/a node "$P" "$@" 2>&1; }
SB() { LEARN_HOME=$SD/b node "$P" "$@" 2>&1; }
SC() { LEARN_HOME=$SD/c node "$P" "$@" 2>&1; }
off() { git -C $SD/$1 config url."$SD/none.git".insteadOf "$SD/r.git"; }
on() { git -C $SD/$1 config --unset url."$SD/none.git".insteadOf; }
PJX() { node -e "const p=require('$SD/'+process.argv[1]+'/profile.json');console.log(JSON.stringify(eval(process.argv[2])))" "$@"; }
# 仓库删了重建、先被第三台推了自己的记录：内容一样的课程不算冲突，这台的新记录照样推得上去
SA init c1 >/dev/null; SA init c2 >/dev/null; SA ask --c c1 "A-1" >/dev/null; SA ask --c c2 "A-2" >/dev/null
SA sync --remote $SD/r.git >/dev/null; SB sync --remote $SD/r.git >/dev/null
rm -rf $SD/r.git; git init -q --bare $SD/r.git
SC init c5 >/dev/null; SC sync --remote $SD/r.git >/dev/null
o=$(SA status); hasnt "同步冲突" "$o"; o=$(SB status); hasnt "同步冲突" "$o"
SB ask --c c1 "B-new" >/dev/null; o=$(git -C $SD/r.git log --format=%s main); has "B-new" "$o"
o=$(git -C $SD/r.git ls-tree -r --name-only main); has "c5/state.json" "$o"; has "c1/state.json" "$o"
# 用户 git 配了 rebase.updateRefs：备份分支照样留着这台被替换掉的记录
git -C $SD/a config rebase.updateRefs true; SA status >/dev/null
off a; SA ask --c c1 "A-备份" >/dev/null; on a; SB ask --c c1 "B-覆盖" >/dev/null
o=$(SA status); has "⚠ 同步冲突：「c1」（c1）" "$o"
o=$(SA sync --keep remote); has "backup/local-" "$o"; o=$(git -C $SD/a log --format=%s --branches='backup/local-*'); has "A-备份" "$o"
# 两边各自新建同名课程，选了仓库那边：课程清单里的标题也跟着仓库那边
off a; SA init c8 --title "A 的课八" >/dev/null; on a; SB status >/dev/null; SB init c8 --title "B 的课八" >/dev/null
o=$(SA status); has "⚠ 同步冲突" "$o"
SA sync --keep remote >/dev/null; o=$(SA list); has "c8「B 的课八」" "$o"; o=$(node -e "console.log(require('$SD/a/index.json').courses.c8.title)"); [ "$o" = "B 的课八" ] && ok || bad "课程清单标题取错了边" "$o"
# 暂停：B 离线先暂停再恢复（净没变），A 暂停了：合并后是暂停
# （A 先记一笔别的，免得两边「暂停」在同一秒生成一模一样的提交）
SB status >/dev/null; off b; SB profile off >/dev/null; SB profile on >/dev/null; SA ask --c c8 "A 暂停前" >/dev/null; SA profile off >/dev/null; on b
SB status >/dev/null; o=$(PJX b 'p.enabled'); [ "$o" = false ] && ok || bad "逐条变化里的暂停丢了" "$o"
SA profile on >/dev/null; SB status >/dev/null
# 证据满 8 条时两边各加一条：用户刚说的自述不会被裁掉
for i in 1 2 3 4 5 6 7 8; do SA profile add Java partial --quote "第$i 次" >/dev/null; done; SB status >/dev/null
off b; SB profile add Java none --quote "其实不会" >/dev/null; on b; SA profile verify Java mastered --detail "答对并说清原因" >/dev/null
SB status >/dev/null; o=$(PJX b 'p.skills.find(s=>s.name==="Java").evidence.map(e=>e.detail).join("|")'); has "「其实不会」" "$o"
# 换个仓库连、推送被拒：退回原来的连接，照常同步
git init -q --bare $SD/rj.git; printf '#!/bin/sh\nexit 1\n' > $SD/rj.git/hooks/pre-receive; chmod +x $SD/rj.git/hooks/pre-receive
o=$(SA sync --remote $SD/rj.git); has "还是连着原来的仓库" "$o"
o=$(SA sync); has "同步仓库：$SD/r.git" "$o"; hasnt "还没连同步仓库" "$o"; SA ask --c c1 "重连失败后" >/dev/null; o=$(git -C $SD/r.git log -1 --format=%s main); has "重连失败后" "$o"
# 仓库里有 index.json 但不是学习记录：不连
git init -q $SD/w; echo '{"name":"app"}' > $SD/w/index.json; mkdir $SD/w/src; echo x > $SD/w/src/a.js; git -C $SD/w add -A; git -C $SD/w commit -qm init; git clone -q --bare $SD/w $SD/w.git
SD9=$(mktemp -d); o=$(LEARN_HOME=$SD9/h node "$P" sync --remote $SD/w.git 2>&1); has "不是学习记录" "$o"
# 被强杀留下的 git 锁、空的数据锁、内容不对的 .sync.json：都不卡
touch $SD/a/.git/index.lock; touch -t 202001010000 $SD/a/.git/index.lock
o=$(SA ask --c c1 "旧锁之后"); hasnt "没能提交" "$o"; o=$(git -C $SD/a log -1 --format=%s); has "旧锁之后" "$o"
: > $SD/a/.learn.lock; touch -t 202001010000 $SD/a/.learn.lock; o=$(SA ask --c c1 "空锁之后"); hasnt "错误" "$o"
echo 999999 > $SD/a/.learn.lock; for i in 1 2 3 4 5 6; do LEARN_HOME=$SD/a node "$P" ask --c c2 "抢锁$i" >/dev/null 2>&1 & done; wait
o=$(node -e "const s=require('$SD/a/c2/state.json');console.log(s.questions.filter(q=>q.text.startsWith('抢锁')).length)"); [ "$o" = 6 ] && ok || bad "接管失效的锁时丢了记录" "$o"
cp $SD/a/.sync.json /tmp/sync.json.bak.$; echo null > $SD/a/.sync.json; o=$(SA status); hasnt "TypeError" "$o"; has "当前课程" "$o"; cp /tmp/sync.json.bak.$ $SD/a/.sync.json; rm -f /tmp/sync.json.bak.$
# 长历史（几百条）的电脑第一次连有别的记录的仓库：很快合上，不误报
LH=$SD/long; LEARN_HOME=$LH node "$P" init big >/dev/null
for i in $(seq 1 300); do echo "- $i" >> $LH/big/log.md; git -C $LH commit -qam "big: $i"; done
s0=$(date +%s); o=$(LEARN_HOME=$LH node "$P" sync --remote $SD/r.git 2>&1); s1=$(date +%s)
has "合在一起了" "$o"; [ $((s1-s0)) -lt 20 ] && ok || bad "长历史合并太慢" "$((s1-s0)) 秒"
o=$(git -C $SD/r.git ls-tree -r --name-only main); has "big/state.json" "$o"; has "c1/state.json" "$o"
o=$(git -C $LH status --porcelain); [ -z "$o" ] && ok || bad "合并后有没提交的文件" "$o"
unset LEARN_SYNC_FOREGROUND

# 先修：最近一次验证没过不能改成已会；画像暂停时说清原因；会不会没记完不能出验证题
fresh T28
L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Vue","role":"related","reason":"r"}]' >/dev/null
L prereq answer Java A >/dev/null
o=$(L prereq quiz Java mastered --detail q); has "先把这一批的「会不会」记完（还差：Vue" "$o"
L prereq answer Vue C >/dev/null; L prereq quiz Java partial --detail q >/dev/null
L profile verify Java mastered --detail "第一次答对" >/dev/null; L profile verify Java none --detail "复核答错" >/dev/null
o=$(L prereq decide Java known); has "最近一次验证没过" "$o"
L profile off >/dev/null; o=$(L prereq decide Java known); has "画像暂停中，不能凭画像改成已会" "$o"; L profile on >/dev/null
L profile verify Java mastered --detail "再复核答对并说清原因" >/dev/null; L profile verify Java mastered --detail "又一题答对" >/dev/null
o=$(L prereq decide Java known); has "Java [必需] a → 已会" "$o"
o=$(L prereq decide Java inline); has "Java [必需] a → 边学边补" "$o"
# 排过新阶段的路线后，不再一直提示「排新阶段的节」
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null; L set-plan --json '[{"id":1,"title":"A"}]' >/dev/null
L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"}]' >/dev/null; L prereq answer Redis C >/dev/null
o=$(L prereq decide Redis inline); has "按 learn-plan 排新阶段的节" "$o"
L set-plan --json '[{"id":1,"title":"A"},{"id":2,"title":"B","uses":["Redis"]}]' >/dev/null
o=$(L prereq); has "先修问答完成。下一步：接着当前节" "$o"
# 读档时定掉的项：先跑了别的会存档的命令，提示也不丢；说过一次就不再说
L prereq set --append --json '[{"name":"Kafka","role":"core","reason":"消息"},{"name":"Go","role":"related","reason":"并发"}]' >/dev/null
L prereq answer Kafka A >/dev/null; L prereq answer Go A >/dev/null
node -e "const f=process.env.LEARN_HOME+'/c1/state.json';const s=require(f);s.prereq.quizSeq=s.prereq.qStart+4;require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
L ask "先问个问题" >/dev/null
o=$(L prereq); has "先用一句话告诉用户：本批验证题名额用完了" "$o"; has "「Go」没验证" "$o"
o=$(L prereq); hasnt "先用一句话告诉用户" "$o"
# v0.3 档案：上一批还剩待定怎么补的项、又追加了一批还没问：新批名额从 0 算
fresh T28
L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"}]' >/dev/null
L prereq answer Java A >/dev/null; L prereq answer Maven C >/dev/null; L prereq quiz Java mastered --detail q >/dev/null
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L prereq set --append --json '[{"name":"Redis","role":"core","reason":"缓存"}]' >/dev/null
node -e "const f=process.env.LEARN_HOME+'/c1/state.json';const s=require(f);const p=s.prereq;delete p.qStart;delete p.batchNo;delete p.plannedBatch;for(const x of p.items){delete x.batch;if(x.source==='intake')x.addedAt='2026-01-01T09:00:00+08:00'}require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
o=$(L prereq answer Redis A); has "本批验证题已出 0/4" "$o"; has "Redis [必需] 缓存 → 待出验证题" "$o"

# ---------- T22 gitignore / 画像不进 git ----------
o=$(cd $LEARN_HOME && git ls-files | grep -c profile); [ "$o" = 0 ] && ok || bad "画像进了 git" "$o"

# ---------- T29 第三轮复查：证据先后、同号新结果、合并中断补完、画像备份、删课、后台推送、嵌套 .git、系统文件、锁、签名钩子、GIT_SSH、首连回退、报错原因、先修节 ----------
T=T29; export LEARN_SYNC_FOREGROUND=1
newpair() { SD=$(mktemp -d); git init -q --bare $SD/r.git; }
SA() { LEARN_HOME=$SD/a node "$P" "$@" 2>&1; }
SB() { LEARN_HOME=$SD/b node "$P" "$@" 2>&1; }
off() { git -C $SD/$1 config url."$SD/none.git".insteadOf "$SD/r.git"; }
on() { git -C $SD/$1 config --unset url."$SD/none.git".insteadOf; }
# 证据先后按记录时刻：B 晚上离线答错，合并后两台都按「降档待复核」算，和在哪台合并无关
newpair
SA init c1 >/dev/null; SA profile verify Java partial --detail "基础题答对" >/dev/null; SA sync --remote $SD/r.git >/dev/null; SB sync --remote $SD/r.git >/dev/null
SA status >/dev/null; SB status >/dev/null
SA profile verify Java mastered --detail "早上答对" >/dev/null
off b; SB status >/dev/null; SB profile verify Java none --detail "晚上全错" >/dev/null; on b
SB status >/dev/null; o=$(SB profile); has "上次验证降了档，需复核" "$o"
SA status >/dev/null; o=$(SA profile); has "上次验证降了档，需复核" "$o"
# 合并时记在 .git 里的「做到一半」记号：分支挪不过去就退回合并前，之后不误报冲突
SA init c2 >/dev/null; SB status >/dev/null
off a; SA ask --c c2 "A 的 c2" >/dev/null; on a; SB ask --c c1 "B 的 c1" >/dev/null
br=$(git -C $SD/a symbolic-ref --short HEAD); touch $SD/a/.git/refs/heads/$br.lock
o=$(SA status); has "合并没成功" "$o"; o=$(git -C $SD/a status --porcelain); [ -z "$o" ] && ok || bad "合并失败后工作区没退回" "$o"
rm -f $SD/a/.git/refs/heads/$br.lock
SA ask --c c1 "A 接着 c1" >/dev/null; o=$(SA status); hasnt "同步冲突" "$o"
o=$(cat $SD/a/c1/log.md); has "B 的 c1" "$o"; has "A 接着 c1" "$o"
# 进程在改完工作区、挪分支之前被杀：下一条命令把合并补完
node -e "const fs=require('fs');let s=fs.readFileSync(process.argv[1],'utf8');const k=\"const u = gitRun(['read-tree', '-m', '-u', plan.head, c.out])\";if(!s.includes(k))process.exit(3);fs.writeFileSync(process.argv[2],s.replace(k,k+';if(process.env.CRASH)process.exit(9)'))" "$P" $SD/crash.mjs
SB status >/dev/null; off a; SA ask --c c2 "A 又问 c2" >/dev/null; on a; SB ask --c c1 "B 又问 c1" >/dev/null
LEARN_HOME=$SD/a CRASH=1 node $SD/crash.mjs status >/dev/null 2>&1; [ $? = 9 ] && ok || bad "没有模拟出中断"
[ -f $SD/a/.git/learn-merge-pending.json ] && ok || bad "中断后没留记号"
o=$(SA ask --c c2 "A 中断后接着问"); has "上次合并同步记录时被打断，已经补完" "$o"
o=$(git -C $SD/a log -1 --format=%s HEAD~1); has "同步：合并另一台电脑的记录" "$o"
o=$(SA status); hasnt "同步冲突" "$o"; [ ! -f $SD/a/.git/learn-merge-pending.json ] && ok || bad "补完后记号还在"
# 另一台清空画像后：这台的画像备份跟着删掉，画像文件坏了也不会把删掉的条目恢复回来
SB status >/dev/null; SB profile add Go partial --quote "G1" >/dev/null; SA status >/dev/null
SA profile reset --confirm yes >/dev/null; SB status >/dev/null
[ ! -f $SD/b/profile.json.bak ] && ok || bad "另一台清空后这台的备份还在" "$(cat $SD/b/profile.json.bak 2>/dev/null | head -c 300)"
SB profile add Python none --quote "P1" >/dev/null; echo '{bad' > $SD/b/profile.json
o=$(SB profile); hasnt "Java" "$o"; hasnt "Go" "$o"
o=$(SA profile reset --confirm yes 2>&1); hasnt "另外删课程" "$o"
# 一台删了课程（目录和清单都删），另一台新建了别的课：合并后清单里也没有它，list 不报错，另一台拉下来也一样
SB status >/dev/null; SA status >/dev/null
rm -rf $SD/a/c2; node -e "const f=process.argv[1];const i=require(f);delete i.courses.c2;require('fs').writeFileSync(f,JSON.stringify(i,null,2))" $SD/a/index.json
off a; SA ask --c c1 "A 删课后" >/dev/null; on a; SB init c3 >/dev/null
o=$(SA status); hasnt "c2" "$o"; o=$(SA list); hasnt "c2" "$o"; has "c3" "$o"
o=$(git -C $SD/a show HEAD:index.json); hasnt '"c2"' "$o"
o=$(SB status); hasnt "c2" "$o"; o=$(SB list); hasnt "错误" "$o"; hasnt "c2" "$o"
# 后台推送只推启动它的那个提交
newpair
SA init c1 >/dev/null; SA sync --remote $SD/r.git >/dev/null
off a; SA ask "第一条" >/dev/null; x=$(git -C $SD/a rev-parse HEAD); SA ask "第二条" >/dev/null; on a
LEARN_HOME=$SD/a node "$P" _push $x >/dev/null 2>&1
br=$(git -C $SD/a symbolic-ref --short HEAD); o=$(git -C $SD/r.git rev-parse $br); [ "$o" = "$x" ] && ok || bad "后台推送推的不是启动它的那个提交" "$o $x"
# skill 从一个 git 工作副本复制过来：不带 .git，文件照常提交、同步
mkdir -p $SD/sk/my-skill; printf -- '---\nname: my-skill\ndescription: test\n---\nhi\n' > $SD/sk/my-skill/SKILL.md
git -C $SD/sk/my-skill init -q; git -C $SD/sk/my-skill -c user.name=t -c user.email=t@t add -A; git -C $SD/sk/my-skill -c user.name=t -c user.email=t@t commit -qm x; echo note > $SD/sk/my-skill/NOTES.md
SA skill add $SD/sk/my-skill --course >/dev/null
[ ! -e $SD/a/c1/skills/my-skill/.git ] && ok || bad "skill 带着 .git 复制过来了"
o=$(git -C $SD/a ls-files -s c1/skills); has "c1/skills/my-skill/SKILL.md" "$o"; hasnt "160000" "$o"
o=$(SA pause --summary "s" --next "n" 2>&1); hasnt "有改动没能提交" "$o"
# 访达的 .DS_Store：不进 git，不算改了课程
SB sync --remote $SD/r.git >/dev/null; SA status >/dev/null
off a; printf '\0\0\0\1Bud1' > $SD/a/c1/.DS_Store; SA list >/dev/null; on a; SB ask "B 的问题" >/dev/null
o=$(SA status); hasnt "同步冲突" "$o"; o=$(git -C $SD/a ls-files); hasnt ".DS_Store" "$o"
fresh T29; L init c1 >/dev/null; printf 'x' > $LEARN_HOME/c1/.DS_Store; git -C $LEARN_HOME add -f c1/.DS_Store; git -C $LEARN_HOME -c user.name=t -c user.email=t@t commit -qm junk
L list >/dev/null; o=$(git -C $LEARN_HOME ls-files); hasnt ".DS_Store" "$o"
# 清理失效锁的「接管锁」本身残留了：照样能拿到锁
echo 999999 > $LEARN_HOME/.learn.lock; touch -t 202001010000 $LEARN_HOME/.learn.lock; : > $LEARN_HOME/.learn.lock.takeover.tmp; touch -t 202001010000 $LEARN_HOME/.learn.lock.takeover.tmp
o=$(L ask "锁残留后"); has "已记为" "$o"; has "这一轮只讲不出题" "$o"; has "learn answer q" "$o"; [ ! -e $LEARN_HOME/.learn.lock ] && ok || bad "数据锁没放掉"
# 用户全局开了提交签名、配了会失败的钩子：学习记录照常提交
G=$(mktemp -d); mkdir -p $G/hooks; printf '#!/bin/sh\nexit 1\n' > $G/hooks/pre-commit; chmod +x $G/hooks/pre-commit
printf '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /usr/bin/false\n[core]\n\thooksPath = %s/hooks\n' "$G" > $G/gitconfig
fresh T29; o=$(GIT_CONFIG_GLOBAL=$G/gitconfig L init c1); hasnt "没能提交" "$o"; o=$(git -C $LEARN_HOME log --oneline | wc -l | tr -d ' '); [ "$o" -ge 1 ] && ok || bad "全局签名配置下没有提交" "$o"
o=$(GIT_CONFIG_GLOBAL=$G/gitconfig L ask "签名配置下"); hasnt "没能提交" "$o"
# 用户设了 GIT_SSH（比如 Windows 上的 plink）：照常用它连
newpair; printf '#!/bin/sh\necho called >> %s/ssh.log\nshift\nexec sh -c "$*"\n' "$SD" > $SD/myssh; chmod +x $SD/myssh
o=$(env -u GIT_SSH_COMMAND GIT_SSH=$SD/myssh GIT_SSH_VARIANT=simple LEARN_HOME=$SD/a node "$P" sync --remote "ssh://fakehost$SD/r.git" 2>&1); has "已连上同步仓库" "$o"; [ -s $SD/ssh.log ] && ok || bad "没用用户的 GIT_SSH"
# 重连同一个仓库、两边一样：不说「拉到了 0 条」
newpair; SA init c1 >/dev/null; SA sync --remote $SD/r.git >/dev/null
o=$(SA sync --remote $SD/r.git); has "已经一致" "$o"; hasnt "拉到了 0 条" "$o"
# 第一次连、两边都有记录，仓库拒收：退回连之前的样子（没开同步的不开；连着别的仓库的照旧连着）
SB init c2 >/dev/null; hb=$(git -C $SD/b rev-parse HEAD)
printf '#!/bin/sh\necho nope-from-hook >&2\nexit 1\n' > $SD/r.git/hooks/pre-receive; chmod +x $SD/r.git/hooks/pre-receive
o=$(SB sync --remote $SD/r.git); has "连上了，但没推上去" "$o"; has "pre-receive hook declined" "$o"; has "没有开同步" "$o"
o=$(git -C $SD/b rev-parse HEAD); [ "$o" = "$hb" ] && ok || bad "拒收后提交没退回" "$o $hb"
[ ! -d $SD/b/c1 ] && ok || bad "拒收后别的电脑的课程还留在这台"; o=$(git -C $SD/b status --porcelain); [ -z "$o" ] && ok || bad "拒收后工作区不干净" "$o"
o=$(git -C $SD/b remote); [ -z "$o" ] && ok || bad "拒收后远程没撤掉" "$o"
git init -q --bare $SD/x.git; SB sync --remote $SD/x.git >/dev/null
o=$(SB sync --remote $SD/r.git); has "还是连着原来的仓库" "$o"
o=$(git -C $SD/b remote get-url origin); [ "$o" = "$SD/x.git" ] && ok || bad "拒收后没恢复原来的仓库" "$o"
o=$(node -e "const s=require('$SD/b/.sync.json');console.log(s.enabled, s.url)"); [ "$o" = "true $SD/x.git" ] && ok || bad "拒收后同步状态不对" "$o"
rm $SD/r.git/hooks/pre-receive
# 先修改成不先补：没学的先修节要去掉，别的节 requires 里的节号自动去掉
fresh T29; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"SQL","role":"core","reason":"查询"}]' >/dev/null; L prereq answer SQL C >/dev/null; L prereq decide SQL learn-first >/dev/null
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"SQL 基础","kind":"prereq","prereqSkill":"SQL"},{"id":2,"title":"正课","uses":["SQL"]}]' >/dev/null
o=$(L prereq decide SQL skip); has "第 1 节是「SQL」的先修节，但用户已经改成不先补了，不要开讲" "$o"
o=$(L status); has "⚠ 路线里第 1 节" "$o"
o=$(L set-plan --json '[{"id":1,"title":"SQL 基础","kind":"prereq","prereqSkill":"SQL"},{"id":2,"title":"正课","uses":["SQL"],"requires":[1]}]'); has "第 1 节从路线里去掉" "$o"
o=$(L set-plan --json '[{"id":2,"title":"正课","uses":["SQL"],"requires":[1]}]'); has "计划已保存，共 1 节" "$o"; has "下一节：第 2 节" "$o"
o=$(L status); hasnt "⚠ 路线里" "$o"
# 名额用完没验证的项，后来验证过会了：必需项改成已会（备注不再写没验证），可类比项改回拿来打比方
fresh T29; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"Maven","role":"core","reason":"b"},{"name":"Docker","role":"core","reason":"c"},{"name":"React","role":"related","reason":"e"},{"name":"Vue","role":"related","reason":"f"}]' >/dev/null
for k in Java Maven Docker React Vue; do L prereq answer $k A >/dev/null; done
L prereq set --append --json '[{"name":"Redis","role":"core","reason":"d"}]' >/dev/null; L prereq answer Redis A >/dev/null
o=$(L prereq); has "Vue [可类比] f → 不拿来打比方（自述能独立做，名额用完没验证）" "$o"
L profile verify Vue mastered --detail "预测 watch 触发时机并说出原因" >/dev/null; o=$(L prereq decide Vue known); has "Vue [可类比] f → 可拿来打比方" "$o"; hasnt "Vue [可类比] f → 可拿来打比方（自述能独立做，名额用完没验证）" "$o"
L profile verify Redis mastered --detail "说出过期淘汰策略区别" >/dev/null; o=$(L prereq decide Redis known); has "Redis [必需] d → 已会" "$o"; o=$(printf '%s' "$o" | grep "Redis \["); hasnt "名额用完没验证" "$o"
# 选边后课程里的验证题编号退回去了：同号的新结果照样记进画像
newpair
SA init c1 >/dev/null; SA set-goal --json '{"exam":"x"}' >/dev/null
SA prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"SQL","role":"core","reason":"b"}]' >/dev/null
SA prereq answer Java A >/dev/null; SA prereq answer SQL A >/dev/null; SA sync --remote $SD/r.git >/dev/null; SB sync --remote $SD/r.git >/dev/null
off a; SA prereq quiz Java mastered --detail q1A >/dev/null; SA prereq quiz SQL mastered --detail q2A >/dev/null; on a
SB status >/dev/null; SB prereq quiz Java none --detail q1B >/dev/null
o=$(SA status); has "同步冲突" "$o"; SA sync --keep remote >/dev/null
o=$(SA prereq quiz SQL none --detail "重新出题答错"); hasnt "没有重复记入" "$o"; has "已记入「SQL」" "$o"
unset LEARN_SYNC_FOREGROUND

# 学过、标了要复习的先修节，改成不先补后照样留在路线里
fresh T29; L init c1 >/dev/null; L set-goal --json '{"exam":"x"}' >/dev/null
L prereq set --json '[{"name":"SQL","role":"core","reason":"查询"}]' >/dev/null; L prereq answer SQL C >/dev/null; L prereq decide SQL learn-first >/dev/null
L baseline --json '[{"ability":"a","level":"none","evidence":"x"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"SQL 基础","kind":"prereq","prereqSkill":"SQL"},{"id":2,"title":"正课","uses":["SQL"]}]' >/dev/null
L start 1 --method coach --criteria x --steps '["a"]' >/dev/null; L done 1 --pass --note ok >/dev/null; L review --lesson 1 >/dev/null
o=$(L prereq decide SQL skip); hasnt "不要开讲" "$o"
o=$(L set-plan --json '[{"id":1,"title":"SQL 基础","kind":"prereq","prereqSkill":"SQL"},{"id":2,"title":"正课","uses":["SQL"],"requires":[1]}]'); has "计划已保存，共 2 节" "$o"
export LEARN_SYNC_FOREGROUND=1
# 用户全局开了 push.gpgSign：照样推得上去
newpair; printf '[push]\n\tgpgSign = true\n' > $SD/gc
o=$(GIT_CONFIG_GLOBAL=$SD/gc LEARN_HOME=$SD/a node "$P" init c1 2>&1; GIT_CONFIG_GLOBAL=$SD/gc LEARN_HOME=$SD/a node "$P" sync --remote $SD/r.git 2>&1); has "已连上同步仓库" "$o"
# 课程目录里放了别的 git 工作副本、里面有改动：不挡同步
SB sync --remote $SD/r.git >/dev/null; SA status >/dev/null
git init -q $SD/demo-src; printf 'x\n' > $SD/demo-src/a.txt; git -C $SD/demo-src -c user.name=t -c user.email=t@t add -A; git -C $SD/demo-src -c user.name=t -c user.email=t@t commit -qm x
git clone -q $SD/demo-src $SD/a/c1/demo; SA ask "放了个示例项目" >/dev/null; echo y > $SD/a/c1/demo/out.log; echo z >> $SD/a/c1/demo/a.txt
SB status >/dev/null; SB init c2 >/dev/null; o=$(SA status); hasnt "没能提交进 git" "$o"; has "拉到了" "$o"; o=$(SA list); has "c2" "$o"
# 换仓库失败退回时，原来分支的上游设置也恢复
newpair; git init -q --bare $SD/x.git
SA init c1 >/dev/null; git -C $SD/a branch -M master; SA sync --remote $SD/x.git >/dev/null
SB init c2 >/dev/null; git -C $SD/b branch -M main; SB sync --remote $SD/r.git >/dev/null
printf '#!/bin/sh\nexit 1\n' > $SD/r.git/hooks/pre-receive; chmod +x $SD/r.git/hooks/pre-receive
o=$(SA sync --remote $SD/r.git); has "还是连着原来的仓库" "$o"
o=$(git -C $SD/a config branch.master.merge); [ "$o" = "refs/heads/master" ] && ok || bad "退回后上游设置不对" "$o"
o=$(git -C $SD/a symbolic-ref --short HEAD); [ "$o" = master ] && ok || bad "退回后分支名不对" "$o"
unset LEARN_SYNC_FOREGROUND
# 后台推送：连着两条命令，后一条要等前一条推完再推，不漏推
newpair; LEARN_SYNC_FOREGROUND=1 SA init c1 >/dev/null; LEARN_SYNC_FOREGROUND=1 SA sync --remote $SD/r.git >/dev/null
printf '#!/bin/sh\nsleep 2\nexit 0\n' > $SD/r.git/hooks/pre-receive; chmod +x $SD/r.git/hooks/pre-receive
SA ask "q1" >/dev/null; sleep 0.5; SA ask "q2" >/dev/null; h=$(git -C $SD/a rev-parse HEAD); br=$(git -C $SD/a symbolic-ref --short HEAD)
for i in $(seq 1 40); do [ "$(git -C $SD/r.git rev-parse $br 2>/dev/null)" = "$h" ] && break; sleep 0.5; done
o=$(git -C $SD/r.git rev-parse $br); [ "$o" = "$h" ] && ok || bad "连着两条命令后最后一条没推上去" "$o $h"

# ---------- T30 实测后补：先修一次记几项、画像回执放最后、说这节会了就直接检验 ----------
fresh T30
L init sb --title "SB" >/dev/null
L set-goal --json '{"exam":"e","profileSkill":"SB"}' >/dev/null
L prereq set --json '[{"name":"Java","role":"core","reason":"a"},{"name":"SQL","role":"core","reason":"b"},{"name":"Maven","role":"general","reason":"c"},{"name":"Express","role":"related","reason":"d","cue":"package.json"},{"name":"Vue","role":"related","reason":"e"}]' >/dev/null
o=$(L prereq); has "答完用一条命令一起记：learn prereq answer --json" "$o"
# 整批校验：有一项不合法就整批不记，画像也不写
o=$(L prereq answer --json '[{"name":"Java","choice":"B"},{"name":"SQL","choice":"X"}]'); has "「SQL」的选项只能是 A" "$o"
o=$(J sb 's.prereq.items.filter(x=>x.answer).length'); [ "$o" = 0 ] && ok || bad "整批不合法时不该记任何一项" "$o"
[ -f $LEARN_HOME/profile.json ] && bad "整批不合法时不该写画像" "$(cat $LEARN_HOME/profile.json)" || ok
o=$(L prereq answer --json '[{"name":"Java","choice":"B"},{"name":"java","choice":"A"}]'); has "「Java」写了两次" "$o"
o=$(L prereq answer --json '[{"name":"Java"}]'); has "缺少「Java」的 choice" "$o"
o=$(L prereq answer --json '{"name":"Java"}'); has "--json 要是非空数组" "$o"
o=$(L prereq answer --json '[{"name":"Java","choice":"b","quote":"写过一点"},{"name":"SQL","choice":"A"},{"name":"Maven","choice":"C"},{"name":"Express","choice":"A"},{"name":"Vue","choice":"D"}]')
has "画像：已记入 「Java」e1 自述会一点 → 现在算会一点" "$o"; has "；「SQL」e2 自述已会 → 现在算会一点" "$o"; has "；「Express」e4 自述已会" "$o"
has "。「Vue」选了「不确定」，不记入。哪条不对，说「删掉某某那条」就删。" "$o"; has "把下面的画像回执一字不改贴给用户" "$o"; has "画像存在 " "$o"
c=$(printf '%s' "$o" | grep -c "先修清单"); [ "$c" = 1 ] && ok || bad "一次记几项只该输出一份清单($c)" "$o"
last=$(printf '%s\n' "$o" | grep -v '^画像存在' | grep . | tail -1); case "$last" in 画像：已记入*) ok;; *) bad "画像回执应在最后" "$o";; esac
has "Java [必需] a → 待出验证题" "$o"; has "Maven [有帮助] c → 待定怎么补（推荐：边学边补）" "$o"; has "Vue [可类比] e → 不拿来打比方" "$o"; has "下一步：给「Java」出 1 道验证题" "$o"
o=$(J sb 's.prereq.items.map(x=>x.name+x.answer).join()'); [ "$o" = '"JavaB,SQLA,MavenC,ExpressA,VueD"' ] && ok || bad "几项的答案没记对" "$o"
o=$(PJ 'p.skills.find(s=>s.name==="Java").evidence[0].detail+"|"+p.skills.find(s=>s.name==="Express").evidence[0].ref'); has "「写过一点」|prereq-a4" "$o"
o=$(git -C $LEARN_HOME log -1 --format=%s); has "先修「Java」：选 B，「SQL」：选 A，「Maven」：选 C" "$o"
o=$(L prereq answer Java A); has "现在不需要问会不会" "$o"
# 验证题：画像回执在最后；选对了追问「为什么」时不给选项
o=$(L prereq quiz Java partial --detail q); last=$(printf '%s\n' "$o" | grep . | tail -1); case "$last" in 画像：已记入「Java」*) ok;; *) bad "验证题的画像回执应在最后" "$o";; esac
has "先追问一句「为什么」再判：让用户用自己的话说，不给选项" "$o"; has "考「Express」本身，不考本课要学的新东西" "$o"; has "把下面的画像回执一字不改贴给用户" "$o"
L prereq quiz Express mastered --detail q >/dev/null; L prereq quiz SQL none --detail q >/dev/null
# 怎么补：一起记，整批校验
o=$(L prereq); has "答完用一条命令一起记：learn prereq decide --json" "$o"
o=$(L prereq decide --json '[{"name":"Java","decision":"inline"},{"name":"SQL","decision":"bogus"}]'); has "决定只能是" "$o"
o=$(J sb 's.prereq.items.find(x=>x.name==="Java").state'); [ "$o" = '"decide"' ] && ok || bad "整批不合法时不该记任何一项" "$o"
o=$(L prereq decide --json '[{"name":"Java","decision":"inline"},{"name":"Java","decision":"skip"}]'); has "「Java」写了两次" "$o"
o=$(L prereq decide --json '[{"name":"Java","decision":"inline"},{"name":"SQL","decision":"learn-first","note":"想先打牢"},{"name":"Maven","decision":"skip"}]')
has "Java [必需] a → 边学边补" "$o"; has "SQL [必需] b → 先补（加先修节）（想先打牢）" "$o"; has "Maven [有帮助] c → 跳过" "$o"; has "先修问答完成" "$o"
o=$(git -C $LEARN_HOME log -1 --format=%s); has "先修怎么补：Java=边学边补，SQL=先补（加先修节），Maven=跳过" "$o"
# 说这节会了：讲解和练习记成跳过，位置条指到检验
L baseline --json '[{"ability":"x","level":"none","evidence":"q"}]' >/dev/null
L set-plan --json '[{"id":1,"kind":"prereq","prereqSkill":"SQL","title":"SQL 先修"},{"id":2,"title":"起项目","requires":[1]},{"id":3,"title":"分层","requires":[2]}]' >/dev/null
o=$(L check 2); has "前置第 1 节「SQL 先修」还没掌握" "$o"
L start 1 --method worked-example --criteria c --steps '["探测","示范","练习","费曼检验"]' >/dev/null
L step 1 1 --result r >/dev/null
o=$(L check 1 --reason "用户说学过"); has "已跳到检验。过了就算掌握（learn done 1 --pass" "$o"; has "📍 第 1 节「SQL 先修」（先修） · 第 4/4 步：费曼检验 · 这是最后一步" "$o"
o=$(J sb 's.lessons[0].steps.map(x=>x.status+":"+(x.result||"")).join("|")'); has "done:r|done:跳过：用户说学过|done:跳过：用户说学过|in_progress:" "$o"
o=$(L done 1 --fail --note "讲不清"); has "已追加 2 步：补练没过的那一项 → 重新检验" "$o"
o=$(L check 1); has "第 6/6 步：重新检验 · 这是最后一步" "$o"
o=$(L done 1 --pass --note ok); has "下一节：第 2 节「起项目」" "$o"
o=$(L check 1); has "第 1 节已经掌握了" "$o"
# 没开始的节也能直接检验：加一步「直接检验」；再说一次不重复加
o=$(L check 2); has "第 1/1 步：直接检验 · 这是最后一步" "$o"
o=$(L check 2); has "第 1/1 步：直接检验" "$o"
# 另一节做到一半：先暂停它
L done 2 --pass --note ok >/dev/null
L start 3 --method coach --criteria c --steps '["探测","练习","费曼检验"]' >/dev/null; L step 3 1 --result r >/dev/null
L set-plan --json '[{"id":1,"kind":"prereq","prereqSkill":"SQL","title":"SQL 先修"},{"id":2,"title":"起项目","requires":[1]},{"id":3,"title":"分层","requires":[2]},{"id":4,"title":"收尾","requires":[2]}]' >/dev/null
o=$(L check 4); has "第 3 节做到第 1/3 步还没检验，已暂停" "$o"; has "📍 第 4 节「收尾」 · 第 1/1 步：直接检验" "$o"
o=$(J sb 's.lessons[2].status'); [ "$o" = '"todo"' ] && ok || bad "另一节该暂停" "$o"
L done 4 --pass --note ok >/dev/null
# 直接检验的节不算进教法效果
L start 3 >/dev/null; L check 3 >/dev/null; L done 3 --pass --note ok >/dev/null
o=$(J sb 's.lessons[2].notes[0].direct+"|"+s.lessons[2].directCheck'); [ "$o" = '"true|undefined"' ] && ok || bad "直接检验该记在检验记录上，节上的标记要清掉" "$o"
for c in c1 c2; do L init $c --title $c >/dev/null; L set-goal --c $c --json '{"exam":"e"}' >/dev/null; L prereq set --c $c --none n >/dev/null; L baseline --c $c --json '[{"ability":"x","level":"none","evidence":"q"}]' >/dev/null; L set-plan --c $c --json '[{"id":1,"title":"t"}]' >/dev/null; L start 1 --c $c --method coach --criteria c --steps '["a","费曼检验"]' >/dev/null; L done 1 --c $c --pass --note ok >/dev/null; done
o=$(L profile); hasnt "练习批改 3/3" "$o"; hasnt "练习批改" "$o"
# 先照常教、首次检验没过，后来用户说会了再直接检验：首次那次照算
L init c3 --title c3 >/dev/null; L set-goal --c c3 --json '{"exam":"e"}' >/dev/null; L prereq set --c c3 --none n >/dev/null; L baseline --c c3 --json '[{"ability":"x","level":"none","evidence":"q"}]' >/dev/null; L set-plan --c c3 --json '[{"id":1,"title":"t"},{"id":2,"title":"t2"}]' >/dev/null
L start 1 --c c3 --method coach --criteria c --steps '["a","费曼检验"]' >/dev/null; L step 1 1 --c c3 --result r >/dev/null; L done 1 --c c3 --fail --note x >/dev/null
L check 1 --c c3 >/dev/null; L done 1 --c c3 --pass --note ok >/dev/null
o=$(L profile); has "练习批改 2/3" "$o"
# 直接检验后又决定学：start --steps 重拆就不算直接检验
L check 2 --c c3 >/dev/null; o=$(J c3 's.lessons[1].directCheck'); [ "$o" = true ] && ok || bad "check 后节上该有标记" "$o"
L set-plan --c c3 --json '[{"id":1,"title":"t"},{"id":2,"title":"t2"},{"id":3,"title":"t3"}]' >/dev/null
o=$(J c3 's.lessons[1].directCheck'); [ "$o" = true ] && ok || bad "改路线不该丢掉直接检验的标记" "$o"
L start 2 --c c3 --method coach --criteria c --steps '["a","费曼检验"]' --force yes >/dev/null; L step 2 1 --c c3 --result r >/dev/null; L done 2 --c c3 --pass --note ok >/dev/null
o=$(J c3 's.lessons[1].notes[0].direct'); [ "$o" = "" ] || [ "$o" = undefined ] && ok || bad "重拆步骤后照常教的检验不该标直接检验" "$o"
o=$(L profile); has "练习批改 3/4" "$o"
# 需复习的节：追加一步检验
L review --c c3 --lesson 1 --reason "忘了" >/dev/null
o=$(L check 1 --c c3); has "第 5/5 步：直接检验 · 这是最后一步" "$o"; hasnt "步骤都做完了" "$o"
o=$(L done 1 --c c3 --pass --note ok); has "下一节" "$o"
o=$(L check 3 --c c3); has '没过（learn done 3 --fail --note "…"）' "$o"
# 直接检验后换教法重拆步骤：也不再算直接检验
L switch 3 --c c3 first-principles "用户想学" --steps '["讲","费曼检验"]' >/dev/null
o=$(J c3 's.lessons[2].directCheck'); [ "$o" = "" ] || [ "$o" = undefined ] && ok || bad "switch 重拆步骤该清掉直接检验的标记" "$o"

# 一项一项记照旧；只有「不确定」时不碰画像
fresh T30b
L init x --title X >/dev/null; L set-goal --json '{"exam":"e"}' >/dev/null
L prereq set --json '[{"name":"Go","role":"related","reason":"r"}]' >/dev/null
o=$(L prereq answer Go D); has "画像：选了「不确定」，不记入。" "$o"; [ -f $LEARN_HOME/profile.json ] && bad "选「不确定」不该写画像" "" || ok
L prereq set --append --json '[{"name":"Rust","role":"related","reason":"r"},{"name":"Zig","role":"related","reason":"r"}]' >/dev/null
o=$(L prereq answer --json '[{"name":"Rust","choice":"D"},{"name":"Zig","choice":"C"}]'); has "画像：已记入 「Zig」e1 自述不会" "$o"; has "。「Rust」选了「不确定」，不记入。" "$o"
L profile off >/dev/null
L prereq set --append --json '[{"name":"C","role":"core","reason":"r"},{"name":"Lua","role":"core","reason":"r"}]' >/dev/null
o=$(L prereq answer --json '[{"name":"C","choice":"A"},{"name":"Lua","choice":"B"}]'); has "画像：已暂停，这次没有记入" "$o"; c=$(printf '%s' "$o" | grep -c "画像："); [ "$c" = 1 ] && ok || bad "暂停时只该有一行画像提示($c)" "$o"
# 一次记几项时，一项写不进（画像满了）不连累别的项：先放 49 个技能，第 50 个能记，第 51 个记不进
L profile on >/dev/null
node -e '
const f=process.env.LEARN_HOME+"/profile.json", p=require(f);
const d=p.skills[0]; p.skills=[]; for(let i=1;i<=49;i++) p.skills.push({...JSON.parse(JSON.stringify(d)),id:"s"+(100+i),name:"T"+i,evidence:d.evidence.map((e,j)=>({...e,id:"e"+(1000+i*10+j)}))});
require("fs").writeFileSync(f,JSON.stringify(p))'
L prereq set --append --json '[{"name":"Ruby","role":"core","reason":"r"},{"name":"Perl","role":"core","reason":"r"}]' >/dev/null
o=$(L prereq answer --json '[{"name":"Ruby","choice":"A"},{"name":"Perl","choice":"B"}]'); has "画像：已记入 「Ruby」" "$o"; has "⚠ 「Perl」没记入：画像里技能已满 50 条" "$o"

# T31 没见过的先讲：换教法提示加载新 skill 和重拆步骤；没细化的节在 status 里看得到摸底；人设和 skill 长度
fresh T31
L init np --title N >/dev/null; L set-goal --json '{"exam":"e"}' >/dev/null; L prereq set --none n >/dev/null
L baseline --json '[{"ability":"numpy","level":"none","evidence":"没接触过"}]' >/dev/null
L set-plan --json '[{"id":1,"title":"数组"},{"id":2,"title":"形状"}]' >/dev/null
o=$(L status); has "摸底（细化这节、选教法时看）：numpy=none（没接触过）" "$o"
L start 1 --method first-principles --criteria c --steps '["暴露假设","基本事实","一步步推","费曼检验"]' >/dev/null
o=$(L status); hasnt "摸底（细化这节" "$o"
o=$(L switch 1 worked-example "从没接触过，先讲"); has "加载 skill teach-worked-example，按它的做法接着教。" "$o"; has "剩下的 4 步是按第一性原理拆的（「暴露假设」「基本事实」「一步步推」「费曼检验」）" "$o"; has "learn switch 1 worked-example \"<原因>\" --steps" "$o"
o=$(L switch 1 worked-example "重拆" --steps '["示范","补全题","独立题","费曼检验"]'); hasnt "剩下的" "$o"; has "第 1/4 步：示范 · 下一步：补全题" "$o"
o=$(J np 's.lessons[0].methodHistory.join(",")'); [ "$o" = '"first-principles,worked-example"' ] && ok || bad "同一教法再 switch 不该重复记进教法历史" "$o"
o=$(L switch 2 coach "还没开讲"); has "开讲这节时 learn start 2，再加载 skill teach-coach。" "$o"; hasnt "按它的做法接着教" "$o"
for i in 1 2 3 4; do L step 1 $i --result r >/dev/null; done
o=$(L switch 1 coach "做完了再换"); has "步骤都做完了：先 learn done 1" "$o"; hasnt "按它的做法接着教" "$o"
L done 1 --pass --note ok >/dev/null; L review --lesson 1 --reason "忘了" >/dev/null
o=$(L status); hasnt "摸底（细化这节" "$o"
ROOT=$(cd "$(dirname "$P")/.." && pwd)
o=$(node -e '
const fs=require("fs"),r=process.argv[1]
const y=fs.readFileSync(r+"/cordis.patch.yml","utf8")
const m=y.split("prefix: |-\n")[1].split("\n          - id: agent-instructions")[0]
const t=m.split("\n").map((l)=>l.replace(/^ {16}/,"")).join("\n")
const out=[]
if(t.length>2500) out.push("人设 "+t.length+" 字，超过 2500")
for(const d of fs.readdirSync(r+"/skills")){const n=fs.readFileSync(r+"/skills/"+d+"/SKILL.md","utf8").length;if(n>=8192) out.push(d+" "+n+" 字，会被截断")}
console.log(out.join("；")||"ok")' "$ROOT"); [ "$o" = ok ] && ok || bad "长度超限" "$o"

echo "通过 $PASS 项，失败 $FAILN 项"
