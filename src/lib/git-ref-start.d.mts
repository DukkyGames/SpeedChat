export interface GitRefBranchLists {
  current?: string;
  local?: string[];
  remote?: string[];
  lockedLocal?: string[];
}

export declare function displayRemoteRef(raw: string): string;
export declare function isSkippedRemoteRef(raw: string): boolean;
export declare function shortLocalNameFromRemote(raw: string): string;
export declare function isListedRemoteRef(raw: string, remoteList?: Iterable<string>): boolean;
export declare function unavailableCheckoutNames(lists: GitRefBranchLists): Set<string>;
export declare function isCheckoutUnavailable(value: string, lists: GitRefBranchLists): boolean;
export declare function pickDefaultStartPoint(
  lists: GitRefBranchLists,
  options?: { forCheckout?: boolean },
): string;
