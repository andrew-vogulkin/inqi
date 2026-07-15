import { WebSearchSource } from '@inqi/shared';

/**
 * Map the async-local usage stage → the cost-breakdown source bucket (HP-15).
 * Shared by every {@link WebSearchProvider}, so a search costs the same bucket
 * whichever backend served it.
 */
export function sourceForStage(stage?: string): WebSearchSource {
  switch (stage) {
    case WebSearchSource.SubjectBuild: return WebSearchSource.SubjectBuild;   // 'subject_build'
    case WebSearchSource.BreadthSearch: return WebSearchSource.BreadthSearch; // 'breadth_search'
    case WebSearchSource.DepthSearch: return WebSearchSource.DepthSearch;     // 'depth_search'
    default: return WebSearchSource.Other; // pre_research / reactor / unset
  }
}
