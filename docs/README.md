# inqi — entity & lifecycle documentation

Deep-dives per entity/process. The top-level [README](../README.md) holds the
end-to-end pipeline; these pages zoom into one lifecycle each, with its
dependencies (what it reads, what it writes, what reacts to it).

| Page | Covers |
|---|---|
| [Report lifecycle](report-lifecycle.md) | Root entity: 14 workflow states, customer-facing stages, credits, lifecycle notifications, snapshot refresh |
| [Inquiry lifecycle](inquiry-lifecycle.md) | One candidate: 8 statuses, research-settles-inquiry rule, unresponsive long-poll, the settlement reactor |
| [Source lifecycle](source-lifecycle.md) | Channel records under an inquiry: flat vs thread sources, Message subentity, budgets, dedupe |
| [Breadth-search lifecycle](breadth-search-lifecycle.md) | Funnel discovery: multi-query search, relevance gate, qualification filter, constraint-relaxing fallback |
| [Depth-search lifecycle](depth-search-lifecycle.md) | Per-candidate research: targeted queries, agentic tool loop, evaluation gate, targeted refine cycles |

Hierarchy the pages hang off:

```
Report (customer request, 1:1 persona, workflow state)
 └── Inquiry (one candidate under investigation)          × up to 8
      └── Source (one channel record: email thread |      × ≤ SOURCES_MAX_PER_INQUIRY
           websearch page | rating digest | whatsapp)
           └── Message (thread sources only: one email    × unbounded
                in/out, compliance-gated)
```
