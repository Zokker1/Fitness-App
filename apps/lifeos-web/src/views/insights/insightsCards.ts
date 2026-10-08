// T271: user-controlled Insights card visibility and order.
export const INSIGHTS_CARD_IDS = [
  "work",
  "goals",
  "nutrition",
  "sleep",
  "mood",
  "measurements",
  "comparison",
] as const;

export type InsightsCardId = (typeof INSIGHTS_CARD_IDS)[number];

export interface InsightsCardOrder {
  readonly visible: readonly InsightsCardId[];
  readonly hidden: readonly InsightsCardId[];
}

export const INSIGHTS_CARD_LABELS: Readonly<Record<InsightsCardId, string>> = {
  work: "Työ ja fokus",
  goals: "Tavoitteet ja rutiinit",
  nutrition: "Ravinto ja nesteytys",
  sleep: "Uni ja aktiivisuus",
  mood: "Mieliala ja energia",
  measurements: "Paino ja vitaalit",
  comparison: "Päiväkohtainen vertailu",
};

const STORAGE_KEY = "lifeos.insights-cards.v1";

function isCardId(value: unknown): value is InsightsCardId {
  return typeof value === "string" && (INSIGHTS_CARD_IDS as readonly string[]).includes(value);
}

function uniqueCardIds(values: readonly unknown[]): InsightsCardId[] {
  const seen = new Set<InsightsCardId>();
  const result: InsightsCardId[] = [];
  for (const value of values) {
    if (isCardId(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export function defaultInsightsCardOrder(): InsightsCardOrder {
  return { visible: [...INSIGHTS_CARD_IDS], hidden: [] };
}

export function resolveInsightsCardOrder(stored: unknown): InsightsCardOrder {
  if (typeof stored !== "object" || stored === null) return defaultInsightsCardOrder();
  const record = stored as Record<string, unknown>;
  const visible = uniqueCardIds(Array.isArray(record.visible) ? record.visible : []);
  const hidden = uniqueCardIds(Array.isArray(record.hidden) ? record.hidden : []).filter(
    (id) => !visible.includes(id),
  );
  const missing = INSIGHTS_CARD_IDS.filter((id) => !visible.includes(id) && !hidden.includes(id));
  return { visible: [...visible, ...missing], hidden };
}

export function moveInsightsCard(
  order: InsightsCardOrder,
  id: InsightsCardId,
  direction: -1 | 1,
): InsightsCardOrder {
  const index = order.visible.indexOf(id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= order.visible.length) return order;
  const visible = [...order.visible];
  const target = visible[targetIndex];
  if (target === undefined) return order;
  visible[index] = target;
  visible[targetIndex] = id;
  return { visible, hidden: order.hidden };
}

export function hideInsightsCard(order: InsightsCardOrder, id: InsightsCardId): InsightsCardOrder {
  if (!order.visible.includes(id)) return order;
  return {
    visible: order.visible.filter((card) => card !== id),
    hidden: [...order.hidden, id],
  };
}

export function showInsightsCard(order: InsightsCardOrder, id: InsightsCardId): InsightsCardOrder {
  if (!order.hidden.includes(id)) return order;
  return {
    visible: [...order.visible, id],
    hidden: order.hidden.filter((card) => card !== id),
  };
}

export function readInsightsCardOrder(): InsightsCardOrder {
  try {
    if (typeof localStorage === "undefined") return defaultInsightsCardOrder();
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null
      ? defaultInsightsCardOrder()
      : resolveInsightsCardOrder(JSON.parse(raw) as unknown);
  } catch {
    return defaultInsightsCardOrder();
  }
}

export function storeInsightsCardOrder(order: InsightsCardOrder): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    }
  } catch {
    // The chosen layout remains active for this session if storage is unavailable.
  }
}
