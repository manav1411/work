// The NeetCode 150 roadmap as a static graph: 18 topic nodes laid out on a grid,
// directed edges between them, and the problems that belong to each topic. This
// mirrors the roadmap at https://neetcode.io/roadmap. Problems reuse the same
// { name, slug, difficulty } shape as homework so they render identically (and
// so solved detection works off the same LeetCode slugs).

import type { HomeworkProblem } from "../../shared/learning";
export type { HomeworkProblem } from "../../shared/learning";

export const ROADMAP_VERSION = 1;

export interface RoadmapTopic {
  /** Stable id, also used as the edge endpoints. */
  id: string;
  /** Display label, matching the NeetCode topic names. */
  label: string;
  /** 1-based grid column (1..5). */
  col: number;
  /** 1-based grid row. */
  row: number;
  problems: HomeworkProblem[];
}

export const roadmapTopics: RoadmapTopic[] = [
  {
    id: "arrays-hashing",
    label: "Arrays & Hashing",
    col: 4,
    row: 1,
    problems: [
      {
        name: "Contains Duplicate",
        slug: "contains-duplicate",
        difficulty: "Easy",
      },
      { name: "Valid Anagram", slug: "valid-anagram", difficulty: "Easy" },
      { name: "Two Sum", slug: "two-sum", difficulty: "Easy" },
      { name: "Group Anagrams", slug: "group-anagrams", difficulty: "Medium" },
      {
        name: "Top K Frequent Elements",
        slug: "top-k-frequent-elements",
        difficulty: "Medium",
      },
      {
        name: "Encode and Decode Strings",
        slug: "encode-and-decode-strings",
        difficulty: "Medium",
      },
      {
        name: "Product of Array Except Self",
        slug: "product-of-array-except-self",
        difficulty: "Medium",
      },
      { name: "Valid Sudoku", slug: "valid-sudoku", difficulty: "Medium" },
      {
        name: "Longest Consecutive Sequence",
        slug: "longest-consecutive-sequence",
        difficulty: "Medium",
      },
    ],
  },
  {
    id: "two-pointers",
    label: "Two Pointers",
    col: 3,
    row: 2,
    problems: [
      {
        name: "Valid Palindrome",
        slug: "valid-palindrome",
        difficulty: "Easy",
      },
      {
        name: "Two Sum II - Input Array Is Sorted",
        slug: "two-sum-ii-input-array-is-sorted",
        difficulty: "Medium",
      },
      { name: "3Sum", slug: "3sum", difficulty: "Medium" },
      {
        name: "Container With Most Water",
        slug: "container-with-most-water",
        difficulty: "Medium",
      },
      {
        name: "Trapping Rain Water",
        slug: "trapping-rain-water",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "stack",
    label: "Stack",
    col: 5,
    row: 2,
    problems: [
      {
        name: "Valid Parentheses",
        slug: "valid-parentheses",
        difficulty: "Easy",
      },
      { name: "Min Stack", slug: "min-stack", difficulty: "Medium" },
      {
        name: "Evaluate Reverse Polish Notation",
        slug: "evaluate-reverse-polish-notation",
        difficulty: "Medium",
      },
      {
        name: "Generate Parentheses",
        slug: "generate-parentheses",
        difficulty: "Medium",
      },
      {
        name: "Daily Temperatures",
        slug: "daily-temperatures",
        difficulty: "Medium",
      },
      { name: "Car Fleet", slug: "car-fleet", difficulty: "Medium" },
      {
        name: "Largest Rectangle in Histogram",
        slug: "largest-rectangle-in-histogram",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "binary-search",
    label: "Binary Search",
    col: 2,
    row: 3,
    problems: [
      { name: "Binary Search", slug: "binary-search", difficulty: "Easy" },
      {
        name: "Search a 2D Matrix",
        slug: "search-a-2d-matrix",
        difficulty: "Medium",
      },
      {
        name: "Koko Eating Bananas",
        slug: "koko-eating-bananas",
        difficulty: "Medium",
      },
      {
        name: "Find Minimum in Rotated Sorted Array",
        slug: "find-minimum-in-rotated-sorted-array",
        difficulty: "Medium",
      },
      {
        name: "Search in Rotated Sorted Array",
        slug: "search-in-rotated-sorted-array",
        difficulty: "Medium",
      },
      {
        name: "Time Based Key-Value Store",
        slug: "time-based-key-value-store",
        difficulty: "Medium",
      },
      {
        name: "Median of Two Sorted Arrays",
        slug: "median-of-two-sorted-arrays",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "sliding-window",
    label: "Sliding Window",
    col: 3,
    row: 3,
    problems: [
      {
        name: "Best Time to Buy and Sell Stock",
        slug: "best-time-to-buy-and-sell-stock",
        difficulty: "Easy",
      },
      {
        name: "Longest Substring Without Repeating Characters",
        slug: "longest-substring-without-repeating-characters",
        difficulty: "Medium",
      },
      {
        name: "Longest Repeating Character Replacement",
        slug: "longest-repeating-character-replacement",
        difficulty: "Medium",
      },
      {
        name: "Permutation in String",
        slug: "permutation-in-string",
        difficulty: "Medium",
      },
      {
        name: "Minimum Window Substring",
        slug: "minimum-window-substring",
        difficulty: "Hard",
      },
      {
        name: "Sliding Window Maximum",
        slug: "sliding-window-maximum",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "linked-list",
    label: "Linked List",
    col: 4,
    row: 3,
    problems: [
      {
        name: "Reverse Linked List",
        slug: "reverse-linked-list",
        difficulty: "Easy",
      },
      {
        name: "Merge Two Sorted Lists",
        slug: "merge-two-sorted-lists",
        difficulty: "Easy",
      },
      { name: "Reorder List", slug: "reorder-list", difficulty: "Medium" },
      {
        name: "Remove Nth Node From End of List",
        slug: "remove-nth-node-from-end-of-list",
        difficulty: "Medium",
      },
      {
        name: "Copy List with Random Pointer",
        slug: "copy-list-with-random-pointer",
        difficulty: "Medium",
      },
      {
        name: "Add Two Numbers",
        slug: "add-two-numbers",
        difficulty: "Medium",
      },
      {
        name: "Linked List Cycle",
        slug: "linked-list-cycle",
        difficulty: "Easy",
      },
      {
        name: "Find the Duplicate Number",
        slug: "find-the-duplicate-number",
        difficulty: "Medium",
      },
      { name: "LRU Cache", slug: "lru-cache", difficulty: "Medium" },
      {
        name: "Merge k Sorted Lists",
        slug: "merge-k-sorted-lists",
        difficulty: "Hard",
      },
      {
        name: "Reverse Nodes in k-Group",
        slug: "reverse-nodes-in-k-group",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "trees",
    label: "Trees",
    col: 3,
    row: 4,
    problems: [
      {
        name: "Invert Binary Tree",
        slug: "invert-binary-tree",
        difficulty: "Easy",
      },
      {
        name: "Maximum Depth of Binary Tree",
        slug: "maximum-depth-of-binary-tree",
        difficulty: "Easy",
      },
      {
        name: "Diameter of Binary Tree",
        slug: "diameter-of-binary-tree",
        difficulty: "Easy",
      },
      {
        name: "Balanced Binary Tree",
        slug: "balanced-binary-tree",
        difficulty: "Easy",
      },
      { name: "Same Tree", slug: "same-tree", difficulty: "Easy" },
      {
        name: "Subtree of Another Tree",
        slug: "subtree-of-another-tree",
        difficulty: "Easy",
      },
      {
        name: "Lowest Common Ancestor of a Binary Search Tree",
        slug: "lowest-common-ancestor-of-a-binary-search-tree",
        difficulty: "Medium",
      },
      {
        name: "Binary Tree Level Order Traversal",
        slug: "binary-tree-level-order-traversal",
        difficulty: "Medium",
      },
      {
        name: "Binary Tree Right Side View",
        slug: "binary-tree-right-side-view",
        difficulty: "Medium",
      },
      {
        name: "Count Good Nodes in Binary Tree",
        slug: "count-good-nodes-in-binary-tree",
        difficulty: "Medium",
      },
      {
        name: "Validate Binary Search Tree",
        slug: "validate-binary-search-tree",
        difficulty: "Medium",
      },
      {
        name: "Kth Smallest Element in a BST",
        slug: "kth-smallest-element-in-a-bst",
        difficulty: "Medium",
      },
      {
        name: "Construct Binary Tree from Preorder and Inorder Traversal",
        slug: "construct-binary-tree-from-preorder-and-inorder-traversal",
        difficulty: "Medium",
      },
      {
        name: "Binary Tree Maximum Path Sum",
        slug: "binary-tree-maximum-path-sum",
        difficulty: "Hard",
      },
      {
        name: "Serialize and Deserialize Binary Tree",
        slug: "serialize-and-deserialize-binary-tree",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "tries",
    label: "Tries",
    col: 1,
    row: 5,
    problems: [
      {
        name: "Implement Trie (Prefix Tree)",
        slug: "implement-trie-prefix-tree",
        difficulty: "Medium",
      },
      {
        name: "Design Add and Search Words Data Structure",
        slug: "design-add-and-search-words-data-structure",
        difficulty: "Medium",
      },
      { name: "Word Search II", slug: "word-search-ii", difficulty: "Hard" },
    ],
  },
  {
    id: "heap-priority-queue",
    label: "Heap / Priority Queue",
    col: 2,
    row: 6,
    problems: [
      {
        name: "Kth Largest Element in a Stream",
        slug: "kth-largest-element-in-a-stream",
        difficulty: "Easy",
      },
      {
        name: "Last Stone Weight",
        slug: "last-stone-weight",
        difficulty: "Easy",
      },
      {
        name: "K Closest Points to Origin",
        slug: "k-closest-points-to-origin",
        difficulty: "Medium",
      },
      {
        name: "Kth Largest Element in an Array",
        slug: "kth-largest-element-in-an-array",
        difficulty: "Medium",
      },
      { name: "Task Scheduler", slug: "task-scheduler", difficulty: "Medium" },
      { name: "Design Twitter", slug: "design-twitter", difficulty: "Medium" },
      {
        name: "Find Median from Data Stream",
        slug: "find-median-from-data-stream",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "backtracking",
    label: "Backtracking",
    col: 4,
    row: 5,
    problems: [
      { name: "Subsets", slug: "subsets", difficulty: "Medium" },
      {
        name: "Combination Sum",
        slug: "combination-sum",
        difficulty: "Medium",
      },
      { name: "Permutations", slug: "permutations", difficulty: "Medium" },
      { name: "Subsets II", slug: "subsets-ii", difficulty: "Medium" },
      {
        name: "Combination Sum II",
        slug: "combination-sum-ii",
        difficulty: "Medium",
      },
      { name: "Word Search", slug: "word-search", difficulty: "Medium" },
      {
        name: "Palindrome Partitioning",
        slug: "palindrome-partitioning",
        difficulty: "Medium",
      },
      {
        name: "Letter Combinations of a Phone Number",
        slug: "letter-combinations-of-a-phone-number",
        difficulty: "Medium",
      },
      { name: "N-Queens", slug: "n-queens", difficulty: "Hard" },
    ],
  },
  {
    id: "one-d-dp",
    label: "1-D DP",
    col: 5,
    row: 6,
    problems: [
      { name: "Climbing Stairs", slug: "climbing-stairs", difficulty: "Easy" },
      {
        name: "Min Cost Climbing Stairs",
        slug: "min-cost-climbing-stairs",
        difficulty: "Easy",
      },
      { name: "House Robber", slug: "house-robber", difficulty: "Medium" },
      {
        name: "House Robber II",
        slug: "house-robber-ii",
        difficulty: "Medium",
      },
      {
        name: "Longest Palindromic Substring",
        slug: "longest-palindromic-substring",
        difficulty: "Medium",
      },
      {
        name: "Palindromic Substrings",
        slug: "palindromic-substrings",
        difficulty: "Medium",
      },
      { name: "Decode Ways", slug: "decode-ways", difficulty: "Medium" },
      { name: "Coin Change", slug: "coin-change", difficulty: "Medium" },
      {
        name: "Maximum Product Subarray",
        slug: "maximum-product-subarray",
        difficulty: "Medium",
      },
      { name: "Word Break", slug: "word-break", difficulty: "Medium" },
      {
        name: "Longest Increasing Subsequence",
        slug: "longest-increasing-subsequence",
        difficulty: "Medium",
      },
      {
        name: "Partition Equal Subset Sum",
        slug: "partition-equal-subset-sum",
        difficulty: "Medium",
      },
    ],
  },
  {
    id: "graphs",
    label: "Graphs",
    col: 4,
    row: 6,
    problems: [
      {
        name: "Number of Islands",
        slug: "number-of-islands",
        difficulty: "Medium",
      },
      {
        name: "Max Area of Island",
        slug: "max-area-of-island",
        difficulty: "Medium",
      },
      { name: "Clone Graph", slug: "clone-graph", difficulty: "Medium" },
      {
        name: "Walls and Gates",
        slug: "walls-and-gates",
        difficulty: "Medium",
      },
      {
        name: "Rotting Oranges",
        slug: "rotting-oranges",
        difficulty: "Medium",
      },
      {
        name: "Pacific Atlantic Water Flow",
        slug: "pacific-atlantic-water-flow",
        difficulty: "Medium",
      },
      {
        name: "Surrounded Regions",
        slug: "surrounded-regions",
        difficulty: "Medium",
      },
      {
        name: "Course Schedule",
        slug: "course-schedule",
        difficulty: "Medium",
      },
      {
        name: "Course Schedule II",
        slug: "course-schedule-ii",
        difficulty: "Medium",
      },
      {
        name: "Graph Valid Tree",
        slug: "graph-valid-tree",
        difficulty: "Medium",
      },
      {
        name: "Number of Connected Components in an Undirected Graph",
        slug: "number-of-connected-components-in-an-undirected-graph",
        difficulty: "Medium",
      },
      {
        name: "Redundant Connection",
        slug: "redundant-connection",
        difficulty: "Medium",
      },
      { name: "Word Ladder", slug: "word-ladder", difficulty: "Hard" },
    ],
  },
  {
    id: "greedy",
    label: "Greedy",
    col: 1,
    row: 7,
    problems: [
      {
        name: "Maximum Subarray",
        slug: "maximum-subarray",
        difficulty: "Medium",
      },
      { name: "Jump Game", slug: "jump-game", difficulty: "Medium" },
      { name: "Jump Game II", slug: "jump-game-ii", difficulty: "Medium" },
      { name: "Gas Station", slug: "gas-station", difficulty: "Medium" },
      {
        name: "Hand of Straights",
        slug: "hand-of-straights",
        difficulty: "Medium",
      },
      {
        name: "Merge Triplets to Form Target Triplet",
        slug: "merge-triplets-to-form-target-triplet",
        difficulty: "Medium",
      },
      {
        name: "Partition Labels",
        slug: "partition-labels",
        difficulty: "Medium",
      },
      {
        name: "Valid Parenthesis String",
        slug: "valid-parenthesis-string",
        difficulty: "Medium",
      },
    ],
  },
  {
    id: "two-d-dp",
    label: "2-D DP",
    col: 4,
    row: 7,
    problems: [
      { name: "Unique Paths", slug: "unique-paths", difficulty: "Medium" },
      {
        name: "Longest Common Subsequence",
        slug: "longest-common-subsequence",
        difficulty: "Medium",
      },
      {
        name: "Best Time to Buy and Sell Stock with Cooldown",
        slug: "best-time-to-buy-and-sell-stock-with-cooldown",
        difficulty: "Medium",
      },
      { name: "Coin Change II", slug: "coin-change-ii", difficulty: "Medium" },
      { name: "Target Sum", slug: "target-sum", difficulty: "Medium" },
      {
        name: "Interleaving String",
        slug: "interleaving-string",
        difficulty: "Medium",
      },
      {
        name: "Longest Increasing Path in a Matrix",
        slug: "longest-increasing-path-in-a-matrix",
        difficulty: "Hard",
      },
      {
        name: "Distinct Subsequences",
        slug: "distinct-subsequences",
        difficulty: "Hard",
      },
      { name: "Edit Distance", slug: "edit-distance", difficulty: "Medium" },
      { name: "Burst Balloons", slug: "burst-balloons", difficulty: "Hard" },
      {
        name: "Regular Expression Matching",
        slug: "regular-expression-matching",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "advanced-graphs",
    label: "Advanced Graphs",
    col: 3,
    row: 7,
    problems: [
      {
        name: "Reconstruct Itinerary",
        slug: "reconstruct-itinerary",
        difficulty: "Hard",
      },
      {
        name: "Min Cost to Connect All Points",
        slug: "min-cost-to-connect-all-points",
        difficulty: "Medium",
      },
      {
        name: "Network Delay Time",
        slug: "network-delay-time",
        difficulty: "Medium",
      },
      {
        name: "Swim in Rising Water",
        slug: "swim-in-rising-water",
        difficulty: "Hard",
      },
      {
        name: "Alien Dictionary",
        slug: "alien-dictionary",
        difficulty: "Hard",
      },
      {
        name: "Cheapest Flights Within K Stops",
        slug: "cheapest-flights-within-k-stops",
        difficulty: "Medium",
      },
    ],
  },
  {
    id: "intervals",
    label: "Intervals",
    col: 2,
    row: 7,
    problems: [
      {
        name: "Insert Interval",
        slug: "insert-interval",
        difficulty: "Medium",
      },
      {
        name: "Merge Intervals",
        slug: "merge-intervals",
        difficulty: "Medium",
      },
      {
        name: "Non-overlapping Intervals",
        slug: "non-overlapping-intervals",
        difficulty: "Medium",
      },
      { name: "Meeting Rooms", slug: "meeting-rooms", difficulty: "Easy" },
      {
        name: "Meeting Rooms II",
        slug: "meeting-rooms-ii",
        difficulty: "Medium",
      },
      {
        name: "Minimum Interval to Include Each Query",
        slug: "minimum-interval-to-include-each-query",
        difficulty: "Hard",
      },
    ],
  },
  {
    id: "math-geometry",
    label: "Math & Geometry",
    col: 5,
    row: 8,
    problems: [
      { name: "Rotate Image", slug: "rotate-image", difficulty: "Medium" },
      { name: "Spiral Matrix", slug: "spiral-matrix", difficulty: "Medium" },
      {
        name: "Set Matrix Zeroes",
        slug: "set-matrix-zeroes",
        difficulty: "Medium",
      },
      { name: "Happy Number", slug: "happy-number", difficulty: "Easy" },
      { name: "Plus One", slug: "plus-one", difficulty: "Easy" },
      { name: "Pow(x, n)", slug: "powx-n", difficulty: "Medium" },
      {
        name: "Multiply Strings",
        slug: "multiply-strings",
        difficulty: "Medium",
      },
      { name: "Detect Squares", slug: "detect-squares", difficulty: "Medium" },
    ],
  },
  {
    id: "bit-manipulation",
    label: "Bit Manipulation",
    col: 5,
    row: 7,
    problems: [
      { name: "Single Number", slug: "single-number", difficulty: "Easy" },
      {
        name: "Number of 1 Bits",
        slug: "number-of-1-bits",
        difficulty: "Easy",
      },
      { name: "Counting Bits", slug: "counting-bits", difficulty: "Easy" },
      { name: "Reverse Bits", slug: "reverse-bits", difficulty: "Easy" },
      { name: "Missing Number", slug: "missing-number", difficulty: "Easy" },
      {
        name: "Sum of Two Integers",
        slug: "sum-of-two-integers",
        difficulty: "Medium",
      },
      {
        name: "Reverse Integer",
        slug: "reverse-integer",
        difficulty: "Medium",
      },
    ],
  },
];

// Directed edges [fromId, toId] describing the recommended learning order. The
// graph flows top-to-bottom, starting at Arrays & Hashing.
export const roadmapEdges: [string, string][] = [
  ["arrays-hashing", "two-pointers"],
  ["arrays-hashing", "stack"],
  ["two-pointers", "binary-search"],
  ["two-pointers", "sliding-window"],
  ["two-pointers", "linked-list"],
  ["binary-search", "trees"],
  ["linked-list", "trees"],
  ["trees", "tries"],
  ["trees", "heap-priority-queue"],
  ["trees", "backtracking"],
  ["backtracking", "one-d-dp"],
  ["backtracking", "graphs"],
  ["one-d-dp", "two-d-dp"],
  ["one-d-dp", "bit-manipulation"],
  ["heap-priority-queue", "greedy"],
  ["heap-priority-queue", "advanced-graphs"],
  ["heap-priority-queue", "intervals"],
  ["graphs", "advanced-graphs"],
  ["graphs", "two-d-dp"],
  ["graphs", "math-geometry"],
  ["bit-manipulation", "math-geometry"],
];

/** Total number of NeetCode 150 problems across all topics. */
export const roadmapTotalProblems = roadmapTopics.reduce(
  (sum, topic) => sum + topic.problems.length,
  0,
);
