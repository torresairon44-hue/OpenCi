import { detectsUserListRequest } from './user-data-service';

export type AgenticRoute =
  | 'multimodal_ai'
  | 'location_tool'
  | 'user_data_tool'
  | 'rag_ai';

export interface AgenticPlan {
  route: AgenticRoute;
  reason: string;
}

function looksLikeLocationRequest(message: string): boolean {
  return /\b(where\s+is|nasaan|asan|location|lokasyon|coordinates?|coord|address|tirahan)\b/i.test(String(message || ''));
}

export function decideAgenticRoute(input: {
  message: string;
  hasImageInput: boolean;
}): AgenticPlan {
  const message = String(input.message || '').trim();

  if (input.hasImageInput) {
    return {
      route: 'multimodal_ai',
      reason: 'Image input detected; route to multimodal AI pipeline.',
    };
  }

  if (looksLikeLocationRequest(message)) {
    return {
      route: 'location_tool',
      reason: 'Location intent detected; prefer deterministic location tool path first.',
    };
  }

  const userListIntent = detectsUserListRequest(message);
  if (userListIntent.isUserListRequest) {
    return {
      route: 'user_data_tool',
      reason: 'User list intent detected; prefer real database grounding path.',
    };
  }

  return {
    route: 'rag_ai',
    reason: 'Default route: RAG-grounded AI response.',
  };
}
