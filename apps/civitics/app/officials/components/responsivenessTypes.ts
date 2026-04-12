// QWEN-ADDED: shared types and helper for civic initiative responsiveness

export type ResponsivenessGrade = "A" | "B" | "C" | "D" | "F";

export type ResponsivenessData = {
  responded: number;
  no_response: number;
  open: number;
  total_closed: number;
  response_rate: number | null;
  grade: ResponsivenessGrade | null;
  recent: Array<{
    initiative_id: string;
    initiative_title: string;
    scope: string;
    response_type: string;
    responded_at: string | null;
    window_closes_at: string;
    window_opened_at: string;
  }>;
};

export function gradeFromRate(rate: number): ResponsivenessGrade {
  if (rate >= 90) return "A";
  if (rate >= 70) return "B";
  if (rate >= 50) return "C";
  if (rate >= 30) return "D";
  return "F";
}
