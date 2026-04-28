import {
  executeToolsNode,
  initAgentNode,
  outputNode,
  reasonNode,
  type AgentLoopNodeContext,
  type DiagnosticPayload,
  type ModelIOPayload,
} from './graph-nodes';
import { createInitialState, type CreateInitialStateParams } from './state';
import { logger } from './logger';
import type { AgentState } from './types';

export interface RunAgentWithStateOptions extends AgentLoopNodeContext {}

const MAX_AGENT_LOOP_ROUNDS = 8;

export async function runAgentWithState(
  state: AgentState,
  options?: RunAgentWithStateOptions
): Promise<AgentState> {
  let currentState = await initAgentNode(state, options ?? {});

  for (let loopIndex = 0; loopIndex < MAX_AGENT_LOOP_ROUNDS; loopIndex += 1) {
    currentState = await reasonNode(currentState, options ?? {});

    if (currentState.control.done) {
      break;
    }

    if (currentState.runtime?.pendingTool) {
      currentState = await executeToolsNode(currentState, options ?? {});
      continue;
    }

    currentState.control.failed = true;
    currentState.control.done = true;
    currentState.answer = currentState.answer ?? '推理节点未返回工具调用，也未生成最终回答。';
    currentState.control.currentStep = 'loop_stalled';
    logger.error('Agent loop stalled', {
      sessionId: currentState.sessionId,
      round: currentState.round,
      state: currentState,
    });
    break;
  }

  if (!currentState.control.done) {
    currentState.control.failed = true;
    currentState.control.done = true;
    currentState.answer =
      currentState.answer ??
      `已达到最大循环次数 ${MAX_AGENT_LOOP_ROUNDS}，仍未完成请求。`;
    currentState.control.currentStep = 'loop_exhausted';
    options?.onDiagnostic?.({
      kind: 'retry',
      title: '达到循环上限',
      content: currentState.answer,
    });
  }

  return outputNode(currentState, options ?? {});
}

export async function runAgentRequest(
  params: CreateInitialStateParams,
  options?: RunAgentWithStateOptions
): Promise<AgentState> {
  const state = createInitialState(params);
  return runAgentWithState(state, options);
}

export type { DiagnosticPayload, ModelIOPayload };
