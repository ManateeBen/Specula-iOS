# Bundled books

Specula seeds two EPUB books on first launch. They are deliberately chosen to
exercise prose, code blocks, formulas, navigation, covers, and explanatory
images without requiring a network connection.

## From Probability to Large Language Models

- Chinese title: *从概率到大模型：一册读懂生成式 AI*
- Author: Specula Editorial
- Copyright: Copyright 2026 Specula. All rights reserved.
- Bundled file: `public/sample-books/Specula_From_Probability_to_LLM.epub`
- Source and diagrams: `scripts/build_bundled_books.py`

This original short book is the product demonstration title. Its seven main
chapters cover tokenization, sampling, attention, training, instruction
following, RAG, and model limitations.

## A Brief Account of Radio-activity

- Author: Francis Preston Venable
- First published: 1917
- Official source: https://www.gutenberg.org/ebooks/32307
- Copyright status: Public domain in the USA
- Bundled file: `public/sample-books/A_Brief_Account_of_Radioactivity.epub`

This concise natural-science book introduces radioactivity, the three kinds of
radiation, radioactive change, alpha particles, atomic structure, and the
impact of radioactivity on chemical theory. The Project Gutenberg text and
illustrations are preserved. Specula only separates the original continuous
document into chapter-level EPUB documents so its navigation and chapter tools
work correctly. The complete Project Gutenberg License remains in the book.

## Rebuild

```powershell
python scripts/build_bundled_books.py C:\path\to\A_Brief_Account_of_Radioactivity.epub
```

Recheck the upstream license and attribution if the source edition changes.
