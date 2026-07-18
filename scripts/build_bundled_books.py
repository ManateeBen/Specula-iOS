from __future__ import annotations

import html
import re
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "sample-books"
SCIENCE_SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else None

CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

PRIMER_STYLE = """
@page { margin: 5%; }
body { color: #151515; background: #f7f3ea; font-family: -apple-system, "Noto Sans SC", sans-serif; line-height: 1.78; margin: 0 auto; max-width: 44rem; padding: 1.2rem; }
h1, h2 { line-height: 1.2; } h1 { font-size: 2rem; margin: 1.2em 0 .6em; } h2 { font-size: 1.25rem; margin-top: 2em; }
p { margin: .9em 0; text-align: justify; } strong { color: #164fd7; } a { color: #164fd7; }
.kicker, .meta, figcaption { font-family: ui-monospace, "SFMono-Regular", monospace; }
.kicker { color: #164fd7; font-size: .78rem; font-weight: 700; } .meta { color: #666; font-size: .78rem; }
.lead { font-size: 1.15rem; line-height: 1.7; } .takeaway { border-left: 4px solid #164fd7; padding: .25rem 1rem; margin: 1.5rem 0; }
pre { background: #121212; color: #f5f1e8; padding: 1rem; overflow-wrap: anywhere; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, "SFMono-Regular", monospace; font-size: .86rem; line-height: 1.55; }
code { font-family: ui-monospace, "SFMono-Regular", monospace; } .formula { background: #fff; border: 1px solid #222; padding: 1rem; overflow-x: auto; text-align: center; }
figure { margin: 1.7rem 0; } figure img { display: block; width: 100%; height: auto; background: #fff; } figcaption { color: #666; font-size: .72rem; margin-top: .5rem; }
.cover { min-height: 86vh; background: #151515; color: #fff; padding: 2rem; display: flex; flex-direction: column; justify-content: space-between; }
.cover h1 { color: #fff; font-size: 3rem; } .cover .number { color: #ffd43b; font-size: 5rem; font-weight: 900; line-height: 1; }
.license { font-size: .9rem; color: #555; }
"""

SCIENCE_STYLE = """
@page { margin: 5%; }
body { color: #171717; background: #fff; font-family: Georgia, serif; line-height: 1.62; margin: 0 auto; max-width: 48rem; padding: 1.2rem; }
h1, h2, h3 { font-family: -apple-system, Arial, sans-serif; line-height: 1.2; } h1 { font-size: 2rem; } h2 { margin-top: 2em; }
p { text-align: left; } pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; background: #f2f2f2; padding: 1rem; font-size: .82rem; }
code { font-family: ui-monospace, "SFMono-Regular", monospace; } img { max-width: 100%; height: auto; }
.titlebox { border-bottom: 3px solid #222; margin-bottom: 2rem; } .author { color: #555; }
table { border-collapse: collapse; max-width: 100%; } td, th { border: 1px solid #bbb; padding: .35rem; }
"""

PRIMER_IMAGES = {
    "cover.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600"><rect width="1200" height="1600" fill="#151515"/><circle cx="600" cy="650" r="390" fill="none" stroke="#f7f3ea" stroke-width="3"/><circle cx="600" cy="650" r="270" fill="none" stroke="#164fd7" stroke-width="44"/><circle cx="600" cy="650" r="95" fill="#ffd43b"/><g fill="#f7f3ea" font-family="Arial,sans-serif"><text x="90" y="130" font-size="42">SPECULA PRESS · SPC-001</text><text x="90" y="1160" font-size="116" font-weight="700">从概率到大模型</text><text x="95" y="1245" font-size="48">一册读懂生成式 AI</text><text x="95" y="1480" font-size="34">SPECULA EDITORIAL · 2026</text></g></svg>""",
    "token-space.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#fff"/><g font-family="Arial,sans-serif"><text x="70" y="80" font-size="34">词语进入模型后的第一站</text><g fill="#164fd7"><rect x="70" y="145" width="170" height="78"/><rect x="260" y="145" width="120" height="78"/><rect x="400" y="145" width="190" height="78"/><rect x="610" y="145" width="120" height="78"/></g><g fill="#fff" font-size="30"><text x="105" y="195">大语言</text><text x="290" y="195">模型</text><text x="435" y="195">不是词典</text><text x="642" y="195">。</text></g><g fill="#ffd43b" stroke="#151515" stroke-width="3"><circle cx="280" cy="520" r="34"/><circle cx="505" cy="430" r="34"/><circle cx="725" cy="555" r="34"/><circle cx="930" cy="410" r="34"/></g><g fill="#151515" font-size="28"><text x="235" y="590">语义位置</text><text x="455" y="375">上下文改变位置</text><text x="650" y="635">距离代表关系</text><text x="860" y="350">向量空间</text></g></g></svg>""",
    "attention-map.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#fff"/><g font-family="Arial,sans-serif"><text x="70" y="75" font-size="34">“它”应该看向谁？</text><g font-size="28"><text x="95" y="170">小猫</text><text x="95" y="270">追逐</text><text x="95" y="370">光点</text><text x="95" y="470">因为</text><text x="95" y="570">它</text><text x="95" y="670">在移动</text></g><g transform="translate(260 105)"><rect width="820" height="570" fill="#f7f3ea"/><g fill="#164fd7"><rect x="0" y="400" width="120" height="90" opacity=".96"/><rect x="140" y="400" width="120" height="90" opacity=".22"/><rect x="280" y="400" width="120" height="90" opacity=".35"/><rect x="420" y="400" width="120" height="90" opacity=".12"/><rect x="560" y="400" width="120" height="90" opacity=".08"/><rect x="700" y="400" width="120" height="90" opacity=".18"/></g><g font-size="24"><text x="22" y="545">小猫</text><text x="162" y="545">追逐</text><text x="302" y="545">光点</text><text x="442" y="545">因为</text><text x="592" y="545">它</text><text x="707" y="545">在移动</text></g></g></g></svg>""",
    "training-loop.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#fff"/><g font-family="Arial,sans-serif" text-anchor="middle"><text x="600" y="70" font-size="34">训练不是背答案，而是反复缩小误差</text><g fill="#f7f3ea" stroke="#151515" stroke-width="4"><rect x="70" y="275" width="210" height="110"/><rect x="365" y="275" width="210" height="110"/><rect x="660" y="275" width="210" height="110"/><rect x="955" y="275" width="175" height="110"/></g><g font-size="30"><text x="175" y="340">输入样本</text><text x="470" y="340">模型预测</text><text x="765" y="340">计算损失</text><text x="1042" y="340">更新参数</text></g><g stroke="#164fd7" stroke-width="8" fill="none"><path d="M280 330 H350"/><path d="M575 330 H645"/><path d="M870 330 H940"/><path d="M1040 405 C1040 610 470 620 470 405"/></g><text x="760" y="585" font-size="26" fill="#164fd7">再来一轮</text></g></svg>""",
    "rag-pipeline.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#fff"/><g font-family="Arial,sans-serif"><text x="70" y="75" font-size="34">RAG：先查资料，再组织回答</text><g stroke="#151515" stroke-width="4"><rect x="70" y="250" width="205" height="130" fill="#ffd43b"/><rect x="360" y="250" width="205" height="130" fill="#f7f3ea"/><rect x="650" y="250" width="205" height="130" fill="#164fd7"/><rect x="940" y="250" width="205" height="130" fill="#151515"/></g><g font-size="30" text-anchor="middle"><text x="172" y="325">用户问题</text><text x="462" y="325">检索片段</text><text x="752" y="325" fill="#fff">加入上下文</text><text x="1042" y="325" fill="#fff">生成回答</text></g><g stroke="#151515" stroke-width="7"><path d="M275 315 H345"/><path d="M565 315 H635"/><path d="M855 315 H925"/></g><text x="600" y="560" text-anchor="middle" font-size="28" fill="#555">模型没有被重新训练；变化的是它这一次能看到的证据。</text></g></svg>""",
}

PRIMER_CHAPTERS = [
    ("cover.xhtml", "封面", """<section class="cover"><div><p class="kicker">SPECULA PRESS · SPC-001</p><div class="number">01</div></div><div><h1>从概率到大模型</h1><p class="lead">一册读懂生成式 AI</p></div><p class="meta">SPECULA EDITORIAL · 2026</p></section>"""),
    ("preface.xhtml", "开始之前：它不是一颗电子大脑", """<p class="kicker">INTRO · 3 MIN</p><h1>开始之前：它不是一颗电子大脑</h1><p class="lead">大语言模型看起来会聊天、会写代码、会解释图片，于是我们很容易把它想成一个住在服务器里的“人”。这本小书换一个更准确、也更有用的视角：它是一台规模惊人的<strong>概率机器</strong>。</p><p>它把文本切成编号，把编号变成向量，再根据上下文估计下一个 token 的概率。数十亿次这样的估计连起来，就形成了段落、程序和对话。能力令人惊讶，但机制并不神秘。</p><p>接下来的七章只解决七个问题：模型看见什么、怎样选择下一个词、注意力做了什么、训练如何发生、对话能力从哪里来、RAG 为什么有效，以及我们应该在什么地方保持怀疑。</p><div class="takeaway"><strong>阅读约定</strong><br/>公式用于压缩关系，代码用于把关系落地，图片用于建立直觉。第一次读时不必停下来推导每一个符号。</div>"""),
    ("chapter-1.xhtml", "01 · 机器看见的不是词", """<p class="kicker">TRACK 01 · TOKENS</p><h1>机器看见的不是词</h1><p class="lead">人读到“模型”，脑中浮现的是意义；模型最先得到的只是整数。</p><p>分词器把字符串切成 token。一个 token 可能是一个汉字、半个英文单词、标点，甚至是一段常见代码。随后，查表操作把 token 编号映射成向量。向量不是词典释义，而是一组可以参与计算的坐标。</p><figure><img src="images/token-space.svg" alt="文本被切成 token 并映射到向量空间的示意图"/><figcaption>FIG 1.1 · token 是入口，向量才是模型内部流动的表示。</figcaption></figure><p>设词表大小为 <em>V</em>，向量维度为 <em>d</em>，嵌入矩阵就是一个 <em>V × d</em> 的表。编号 <em>i</em> 的 token 对应第 <em>i</em> 行：</p><div class="formula"><p>eᵢ = E[i]，E ∈ R^(V×d)</p></div><h2>为什么切分方式很重要</h2><p>如果 token 太细，序列会变长，计算成本上升；如果太粗，罕见词会大量出现，模型难以共享规律。现代分词器通常在两者之间折中，让常见片段保持完整，让生词能够拆开。</p><pre><code>text = "模型不是词典"\nids = tokenizer.encode(text)\nprint(ids)\n# [314, 1592, 782, 4410, ...]</code></pre><div class="takeaway"><strong>带走一句话</strong><br/>模型并不直接处理“意义”，它处理的是 token 在上下文中逐层变化的向量表示。</div>"""),
    ("chapter-2.xhtml", "02 · 下一词是一场概率竞赛", """<p class="kicker">TRACK 02 · PROBABILITY</p><h1>下一词是一场概率竞赛</h1><p class="lead">生成不是从数据库里取出完整答案，而是在每一步重新举行一次候选词竞赛。</p><p>模型为词表中的每个 token 计算一个分数，称为 logit。Softmax 把这些任意大小的分数变成总和为 1 的概率：</p><div class="formula"><p>P(xᵢ) = exp(zᵢ) / Σⱼ exp(zⱼ)</p></div><p>如果总选概率最高的 token，输出会稳定但容易僵硬；如果按概率随机抽样，文本会更多样，也更可能偏离事实。temperature 改变概率分布的陡峭程度：温度低，强者更强；温度高，冷门候选也有机会。</p><pre><code>import math, random\n\ndef sample(logits, temperature=0.8):\n    scaled = [x / temperature for x in logits]\n    peak = max(scaled)\n    weights = [math.exp(x - peak) for x in scaled]\n    return random.choices(range(len(weights)), weights=weights)[0]</code></pre><p>这也解释了同一个问题为什么可能得到不同答案：生成过程不是复制，而是一条由许多概率选择组成的路径。</p><div class="takeaway"><strong>带走一句话</strong><br/>大模型最基本的动作只有一个：根据已经出现的内容，为下一个 token 分配概率。</div>"""),
    ("chapter-3.xhtml", "03 · 注意力：决定此刻该看哪里", """<p class="kicker">TRACK 03 · ATTENTION</p><h1>注意力：决定此刻该看哪里</h1><p class="lead">一句话中的每个位置都可以向其他位置发问：谁与我现在要做的判断最相关？</p><p>自注意力把每个位置变成三组向量：Query 表示“我在找什么”，Key 表示“我能被怎样找到”，Value 表示“如果找到我，可以取走什么信息”。Query 与 Key 的相似度决定权重，再对 Value 加权求和。</p><div class="formula"><p>Attention(Q,K,V) = softmax(QKᵀ / √dₖ)V</p></div><figure><img src="images/attention-map.svg" alt="代词它对句子中不同词语分配不同注意力权重的热力图"/><figcaption>FIG 3.1 · 深色不等于永久规则，只表示这一层、这一头、这一位置的较高权重。</figcaption></figure><p>多头注意力意味着模型可以同时学习多种关系：一个头追踪代词指代，另一个头留意语法结构，还有的头关注时间或代码中的括号配对。层层叠加后，表示不再属于某个孤立词，而属于它所处的具体上下文。</p><div class="takeaway"><strong>带走一句话</strong><br/>注意力不是“模型专心了”，而是一种可微分的信息路由机制。</div>"""),
    ("chapter-4.xhtml", "04 · 训练：用误差雕刻参数", """<p class="kicker">TRACK 04 · TRAINING</p><h1>训练：用误差雕刻参数</h1><p class="lead">模型开始时不会语言。它只是一个拥有大量随机参数的函数。</p><p>训练样本给出一段上下文和真实的下一个 token。模型预测概率后，交叉熵损失衡量它给正确答案分配的概率有多低。正确 token 的概率越接近 1，损失越小：</p><div class="formula"><p>L = −log P(xₜ₊₁ | x≤t)</p></div><figure><img src="images/training-loop.svg" alt="输入、预测、损失和参数更新组成的训练循环"/><figcaption>FIG 4.1 · 梯度指出怎样微调参数能让下一次误差更小。</figcaption></figure><p>反向传播计算每个参数对损失的影响，优化器沿着降低损失的方向更新参数。一个简化的梯度下降更新式是：</p><div class="formula"><p>θ ← θ − η∇θL</p></div><p>预训练让模型从大规模文本中学习语言与世界规律；指令微调让它学会遵循任务格式；偏好优化则让输出更符合人类对帮助性与安全性的选择。它们不是三颗不同的大脑，而是同一组参数经历的不同训练阶段。</p><div class="takeaway"><strong>带走一句话</strong><br/>知识没有以文章原文的形式塞进模型；它被分散地压缩进大量参数之间的关系。</div>"""),
    ("chapter-5.xhtml", "05 · 为什么补全器会聊天", """<p class="kicker">TRACK 05 · CONVERSATION</p><h1>为什么补全器会聊天</h1><p class="lead">“预测下一个 token”听起来很窄，但许多任务都可以被改写成文本续写。</p><p>翻译可以写成“中文：…… 英文：”；分类可以写成“评论：…… 情感：”；问答则是“问题：…… 回答：”。只要训练材料中存在这些结构，模型就可能学会延续结构。规模扩大后，少量示例甚至能在上下文中临时定义一种新任务，这通常被称为上下文学习。</p><h2>上下文不是长期记忆</h2><p>系统提示、聊天历史、检索片段和当前问题通常会被拼进同一个上下文窗口。模型能利用它们，但窗口结束后，这些 token 并不会自动写回参数。把“本轮看见”误认为“永久记住”，会导致错误的产品设计与隐私判断。</p><pre><code>messages = [\n    {"role": "system", "content": "回答要引用证据"},\n    {"role": "user", "content": "为什么天空是蓝色？"},\n]\nresponse = model.generate(messages)</code></pre><p>对话界面还制造了一种强烈错觉：语言连贯等于理解可靠。事实上，流畅是模型的训练目标直接奖励的东西，而事实正确往往需要额外证据、工具调用或校验。</p><div class="takeaway"><strong>带走一句话</strong><br/>聊天能力来自任务的文本化、指令训练和上下文学习；流畅本身不是事实保证。</div>"""),
    ("chapter-6.xhtml", "06 · RAG 与工具：让模型先查再答", """<p class="kicker">TRACK 06 · RETRIEVAL</p><h1>RAG 与工具：让模型先查再答</h1><p class="lead">当答案依赖私有资料或最新事实时，与其期待模型“本来就知道”，不如在生成前把证据交给它。</p><p>检索增强生成（RAG）通常先把文档切成片段并计算向量。用户提问时，系统寻找语义上最接近的片段，将它们与问题一起送入模型。模型参数没有变化，变化的是这一次推理能看到的材料。</p><figure><img src="images/rag-pipeline.svg" alt="问题经过检索、上下文拼接再由模型生成回答的 RAG 流程图"/><figcaption>FIG 6.1 · 检索负责找到证据，模型负责组织语言；两者都可能出错。</figcaption></figure><pre><code>def answer(question, index, llm):\n    passages = index.search(question, top_k=4)\n    context = "\\n\\n".join(p.text for p in passages)\n    prompt = "只根据资料回答；资料不足就明确说不知道。\\n" + context\n    return llm(prompt + "\\n问题：" + question)</code></pre><p>真正可靠的系统还要记录来源、限制片段权限、评估检索召回率，并防御文档中的提示注入。工具调用也遵循同一原则：模型提出结构化意图，程序验证参数并执行，结果再返回给模型。不要让一段自然语言直接拥有不可逆的系统权限。</p><div class="takeaway"><strong>带走一句话</strong><br/>RAG 不会自动消灭幻觉，它把问题拆成了“是否找到正确证据”和“是否忠实使用证据”。</div>"""),
    ("chapter-7.xhtml", "07 · 边界：什么时候不该相信它", """<p class="kicker">TRACK 07 · LIMITS</p><h1>边界：什么时候不该相信它</h1><p class="lead">模型可以生成形式完美、内容错误的句子，因为“像答案”与“是事实”并不是同一个目标。</p><p>幻觉常见于三种情形：训练材料中缺少答案，上下文提供了冲突证据，或任务要求精确计算与引用但没有工具支持。降低 temperature 只能减少随机性，不能把未知事实变成已知事实。</p><h2>一个实用的信任阶梯</h2><p><strong>可直接使用：</strong>改写、头脑风暴、格式转换，但仍需注意敏感数据。<br/><strong>需要复核：</strong>代码、技术解释、摘要，使用测试或原文对照。<br/><strong>必须由人负责：</strong>医疗、法律、财务、安全操作，以及任何不可逆决定。</p><p>评估也应贴近真实任务。不要只问“回答看起来好吗”，而要分别测量：事实正确率、引用忠实度、拒答是否恰当、延迟、成本和不同人群上的失败模式。</p><pre><code>def guarded_answer(question):\n    evidence = retrieve(question)\n    draft = generate(question, evidence)\n    checks = verify_claims(draft, evidence)\n    if not checks.all_supported:\n        return "现有资料不足以可靠回答。"\n    return attach_citations(draft, evidence)</code></pre><div class="takeaway"><strong>最后一句话</strong><br/>把大模型当作会使用语言的概率系统，而不是权威。理解它的机制，才能既大胆使用，又知道在哪里停下。</div>"""),
    ("about.xhtml", "关于本书", """<p class="kicker">COLOPHON</p><h1>关于本书</h1><p>《从概率到大模型：一册读懂生成式 AI》由 Specula Editorial 于 2026 年编写，作为 Specula 阅读体验的内置演示书。</p><p>本书中的文字、代码与示意图均为原创内容。代码仅用于解释概念，不构成生产环境实现建议。</p><p class="license">Copyright © 2026 Specula. All rights reserved.</p>"""),
]


def xhtml(title: str, body: str, language: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{language}" xml:lang="{language}">
<head><meta charset="UTF-8"/><title>{html.escape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>{body}</body></html>"""


def media_type(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return {".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif"}.get(suffix, "image/jpeg")


def write_epub(output_name, identifier, title, creator, language, style, chapters, images, rights):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / output_name
    with zipfile.ZipFile(output, "w") as book:
        book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        book.writestr("META-INF/container.xml", CONTAINER_XML, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr("OEBPS/style.css", style, compress_type=zipfile.ZIP_DEFLATED)
        manifest = [
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="style" href="style.css" media-type="text/css"/>',
        ]
        spine = []
        for index, (filename, chapter_title, body) in enumerate(chapters):
            item_id = f"chapter-{index}"
            book.writestr(f"OEBPS/{filename}", xhtml(chapter_title, body, language), compress_type=zipfile.ZIP_DEFLATED)
            manifest.append(f'<item id="{item_id}" href="{filename}" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="{item_id}"/>')
        for index, (filename, data) in enumerate(images.items()):
            properties = ' properties="cover-image"' if filename.startswith("cover.") else ""
            book.writestr(f"OEBPS/images/{filename}", data, compress_type=zipfile.ZIP_DEFLATED)
            manifest.append(f'<item id="image-{index}" href="images/{filename}" media-type="{media_type(filename)}"{properties}/>')
        nav_items = "".join(f'<li><a href="{filename}">{html.escape(chapter_title)}</a></li>' for filename, chapter_title, _ in chapters)
        book.writestr("OEBPS/nav.xhtml", xhtml("目录", f'<nav epub:type="toc" id="toc"><h1>目录</h1><ol>{nav_items}</ol></nav>', language), compress_type=zipfile.ZIP_DEFLATED)
        package = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="{language}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">{identifier}</dc:identifier><dc:title>{html.escape(title)}</dc:title><dc:creator>{html.escape(creator)}</dc:creator><dc:language>{language}</dc:language><dc:rights>{html.escape(rights)}</dc:rights><meta property="dcterms:modified">2026-07-18T00:00:00Z</meta></metadata>
<manifest>{"".join(manifest)}</manifest><spine>{"".join(spine)}</spine></package>"""
        book.writestr("OEBPS/content.opf", package, compress_type=zipfile.ZIP_DEFLATED)


def build_primer():
    write_epub(
        "Specula_From_Probability_to_LLM.epub",
        "urn:specula:from-probability-to-llm:2026",
        "从概率到大模型：一册读懂生成式 AI",
        "Specula Editorial",
        "zh-CN",
        PRIMER_STYLE,
        PRIMER_CHAPTERS,
        {name: data.encode("utf-8") for name, data in PRIMER_IMAGES.items()},
        "Copyright © 2026 Specula. All rights reserved.",
    )


def extract_body(source: str) -> str:
    match = re.search(r"<body[^>]*>([\s\S]*?)</body>", source, re.IGNORECASE)
    return match.group(1) if match else source


def normalize_science_fragment(fragment: str) -> str:
    fragment = re.sub(
        r'src="(?!https?://|data:|images/)([^"]+)"',
        lambda item: f'src="images/{Path(item.group(1)).name}"',
        fragment,
    )
    return re.sub(r'href="[^"#]+#([^"]+)"', r'href="#\1"', fragment)


def build_science_book():
    if not SCIENCE_SOURCE:
        return

    with zipfile.ZipFile(SCIENCE_SOURCE) as source_book:
        xhtml_names = [name for name in source_book.namelist() if name.lower().endswith((".xhtml", ".html"))]
        main_name = next(
            name for name in xhtml_names
            if b'CHAPTER_I' in source_book.read(name)
        )
        main_body = extract_body(source_book.read(main_name).decode("utf-8"))
        chapter_marks = list(re.finditer(
            r'<h2[^>]*>\s*<a[^>]+id="CHAPTER_([IVX]+)"[^>]*/>\s*CHAPTER\s+[IVX]+\s*</h2>',
            main_body,
            re.IGNORECASE,
        ))
        index_mark = re.search(r'<h2[^>]*>\s*<a[^>]+id="INDEX"', main_body, re.IGNORECASE)
        if len(chapter_marks) != 6 or not index_mark:
            raise RuntimeError("Unexpected Project Gutenberg chapter structure")

        preface_start = main_body.index('<h2 id="pgepubid00005">PREFACE</h2>')
        preface_end = main_body.index('<h2 id="pgepubid00008">CONTENTS</h2>')
        chapters = [("preface.xhtml", "Preface", normalize_science_fragment(main_body[preface_start:preface_end]))]
        for index, mark in enumerate(chapter_marks):
            end = chapter_marks[index + 1].start() if index + 1 < len(chapter_marks) else index_mark.start()
            fragment = normalize_science_fragment(main_body[mark.start():end])
            title_match = re.search(r'<h3[^>]*>([\s\S]*?)</h3>', fragment, re.IGNORECASE)
            title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else f"Chapter {index + 1}"
            chapters.append((f"chapter-{index + 1}.xhtml", title, fragment))

        license_name = next(name for name in xhtml_names if b'pg-footer-heading' in source_book.read(name))
        license_body = normalize_science_fragment(extract_body(source_book.read(license_name).decode("utf-8")))
        attribution = """<div class="titlebox"><h1>Source and License</h1></div><p><em>A Brief Account of Radio-activity</em> by Francis Preston Venable, first published in 1917.</p><p>This edition preserves the Project Gutenberg text and illustrations. Specula only reorganized the source into one EPUB document per chapter for reading navigation.</p><p>Official source: <a href="https://www.gutenberg.org/ebooks/32307">Project Gutenberg eBook #32307</a>.</p>"""
        chapters.append(("license.xhtml", "Source and Project Gutenberg License", attribution + license_body))

        image_names = [name for name in source_book.namelist() if media_type(name).startswith("image/")]
        images = {Path(name).name: source_book.read(name) for name in image_names}
        cover_name = next((name for name in images if "cover" in name.lower()), None)
        if cover_name:
            suffix = Path(cover_name).suffix.lower()
            images[f"cover{suffix}"] = images.pop(cover_name)
    write_epub(
        "A_Brief_Account_of_Radioactivity.epub",
        "https://www.gutenberg.org/ebooks/32307",
        "A Brief Account of Radio-activity",
        "Francis Preston Venable",
        "en",
        SCIENCE_STYLE,
        chapters,
        images,
        "Public domain in the USA; Project Gutenberg License included",
    )


build_primer()
build_science_book()
print("Bundled EPUBs generated in public/sample-books")
