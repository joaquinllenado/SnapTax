import type { IntakeReplyToolOutput } from "@/app/api/agents/intake-agent";
import { askHydraReceiptQuestion, isHydraPersistenceEnabled } from "@/lib/hydradb-receipts";

export type QueryAnswerAgentResult =
  | {
      status: "answered";
      answer: string;
      sourceCount: number;
      queryKind: NonNullable<IntakeReplyToolOutput["queryKind"]>;
      normalizedQuestion: string;
    }
  | {
      status: "rejected";
      reason: string;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export async function answerReceiptQueryWithHydra(
  intakeResult: IntakeReplyToolOutput,
): Promise<QueryAnswerAgentResult> {
  if (!intakeResult.accepted || !intakeResult.hydra || !intakeResult.queryKind || !intakeResult.normalizedQuestion) {
    return {
      status: "rejected",
      reason: intakeResult.rejectionReason ?? "invalid_intake_request",
    };
  }

  if (!isHydraPersistenceEnabled()) {
    return {
      status: "unavailable",
      reason: "hydra_not_configured",
    };
  }

  const hydraResult = await askHydraReceiptQuestion({
    question: intakeResult.hydra.question,
    maxChunks: intakeResult.hydra.maxChunks,
    maxTokens: intakeResult.hydra.maxTokens,
    mode: intakeResult.hydra.mode,
    temperature: intakeResult.hydra.temperature,
  });

  return {
    status: "answered",
    answer: hydraResult.answer,
    sourceCount: hydraResult.chunks.length,
    queryKind: intakeResult.queryKind,
    normalizedQuestion: intakeResult.normalizedQuestion,
  };
}
