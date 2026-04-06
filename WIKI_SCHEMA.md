# Hex2077 LLM Wiki Schema (Refined)

This schema defines how `opencode` (the AI agent) maintains the project's knowledge base, following the pattern proposed by Andrej Karpathy.

## 1. Directory Structure

- `data/raw/`: **Raw Sources Layer**. Immutable original documents (PDFs, text, images, transcripts). These are the source of truth.
- `data/knowledge_store/`: **The Wiki Layer**. LLM-generated and maintained synthesized knowledge.
  - `entities/`: Pages for specific models, companies, or tools (e.g., `Claude-3.7.md`).
  - `concepts/`: Pages for technical concepts and paradigms (e.g., `MCP-Protocol.md`).
  - `summaries/`: Ingested summaries of individual raw documents (replacing the ID-based folders).
  - `index.json`: Machine-readable metadata and cross-references.
  - `index.md`: Human-readable catalog of the Wiki.
  - `log.md`: Chronological log of ingests and updates.

## 2. Refined Workflow

### Step 1: Place Source
The user adds a new original document to `data/raw/`.

### Step 2: Ingest & Summarize
`opencode` reads the raw file, extracts key takeaways, and creates a summary file in `data/knowledge_store/summaries/` (using a human-readable name, e.g., `2026-04-06-Karpathy-Wiki.md`).

### Step 3: Synthesize & Update
`opencode` identifies relevant entities and concepts mentioned in the new summary:
- If an entity/concept page already exists (e.g., `concepts/Agentic-AI.md`), it is **updated** with the new information.
- If it doesn't exist, a **new page** is created.
- **Interlinking**: Automatically add `[[WikiLinks]]` between summaries and synthesized pages.

### Step 4: Index & Log
- Update `data/knowledge_store/index.json` with metadata.
- Update `data/knowledge_store/index.md` with a 1-line summary of the new document.
- Log the operation in `data/knowledge_store/log.md`.

## 3. Guiding Principles

- **Immutability of Raw**: Never modify files in `data/raw/`.
- **Knowledge Compounding**: The Wiki should grow more structured and insightful with each ingest, not just more voluminous.
- **Deduplication**: Avoid redundant content; if multiple sources discuss the same thing, the specialized entity/concept page is the place for the combined view.
