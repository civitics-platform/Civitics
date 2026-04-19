/**
 * Topic / issue-area vocabulary shared by the AI tagger and the enrichment
 * queue. Lives in its own file to avoid a cycle between ai-tagger.ts and
 * enrichment/queue.ts (both need these constants; ai-tagger pulls queue.ts
 * for its queue-mode branch).
 */

export const TOPIC_ICONS: Record<string, string> = {
  climate:             "🌊",
  healthcare:          "🏥",
  finance:             "📈",
  education:           "📚",
  housing:             "🏠",
  transportation:      "🚗",
  agriculture:         "🌾",
  energy:              "⚡",
  defense:             "🛡",
  technology:          "💻",
  labor:               "👷",
  immigration:         "🌍",
  civil_rights:        "⚖️",
  veterans:            "🎖",
  food_safety:         "🍽",
  consumer_protection: "🛡",
  environment:         "🌊",
  public_health:       "🏥",
  trade:               "🤝",
  other:               "📋",
};

export const VALID_TOPICS = Object.keys(TOPIC_ICONS);

export const ISSUE_AREAS = [
  "healthcare", "climate", "finance", "education", "defense",
  "technology", "labor", "agriculture", "housing", "immigration",
  "civil_rights", "veterans", "energy", "trade",
];
