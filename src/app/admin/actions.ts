"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { verifyPassword, createSession, destroySession } from "@/lib/adminAuth";
import type { Provider } from "@prisma/client";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!verifyPassword(password)) {
    redirect("/admin/login?error=1");
  }
  await createSession();
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}

export async function saveProviderConfigAction(formData: FormData) {
  const provider = String(formData.get("provider")) as Provider;
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const defaultModelId = String(formData.get("defaultModelId") ?? "").trim();
  const inputPricePerMillion = Number(formData.get("inputPricePerMillion"));
  const outputPricePerMillion = Number(formData.get("outputPricePerMillion"));

  if (!defaultModelId || !Number.isFinite(inputPricePerMillion) || !Number.isFinite(outputPricePerMillion)) {
    throw new Error("Model ID and both prices are required.");
  }

  const existing = await prisma.providerConfig.findUnique({ where: { provider } });

  if (apiKey) {
    const { encrypted, iv, authTag } = encrypt(apiKey);
    await prisma.providerConfig.upsert({
      where: { provider },
      create: {
        provider,
        encryptedApiKey: encrypted,
        iv,
        authTag,
        defaultModelId,
        inputPricePerMillion,
        outputPricePerMillion,
      },
      update: {
        encryptedApiKey: encrypted,
        iv,
        authTag,
        defaultModelId,
        inputPricePerMillion,
        outputPricePerMillion,
      },
    });
  } else {
    if (!existing) {
      throw new Error("An API key is required the first time you configure a provider.");
    }
    // Leave the stored key untouched -- lets the admin tune the model ID
    // or pricing without re-entering the key every time.
    await prisma.providerConfig.update({
      where: { provider },
      data: { defaultModelId, inputPricePerMillion, outputPricePerMillion },
    });
  }

  revalidatePath("/admin/settings");
}

const DISPLAY_NAMES: Record<Provider, string> = {
  ANTHROPIC: "Claude",
  OPENAI: "GPT",
  GOOGLE: "Gemini",
};

export async function createRunAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || null;
  const perAgentBudget = Number(formData.get("perAgentBudget"));
  const totalBudget = Number(formData.get("totalBudget"));
  const roundCapPerPhase = Number(formData.get("roundCapPerPhase"));

  if (![perAgentBudget, totalBudget, roundCapPerPhase].every(Number.isFinite)) {
    throw new Error("Budget and round cap fields must be numbers.");
  }

  const configs = await prisma.providerConfig.findMany();
  const requiredProviders: Provider[] = ["ANTHROPIC", "OPENAI", "GOOGLE"];
  for (const p of requiredProviders) {
    if (!configs.some((c) => c.provider === p)) {
      throw new Error(`Configure an API key for ${DISPLAY_NAMES[p]} (${p}) before creating a run.`);
    }
  }

  await prisma.run.create({
    data: {
      name,
      totalBudgetCapUsd: totalBudget,
      roundCapPerPhase,
      agents: {
        create: requiredProviders.map((provider, seatIndex) => {
          const config = configs.find((c) => c.provider === provider)!;
          return {
            provider,
            displayName: DISPLAY_NAMES[provider],
            modelId: config.defaultModelId,
            seatIndex,
            budgetCapUsd: perAgentBudget,
          };
        }),
      },
    },
  });

  revalidatePath("/admin");
}

export async function startRunAction(formData: FormData) {
  const runId = String(formData.get("runId"));
  await prisma.run.update({
    where: { id: runId },
    data: { status: "ACTIVE", startedAt: new Date() },
  });
  revalidatePath("/admin");
}

export async function pauseRunAction(formData: FormData) {
  const runId = String(formData.get("runId"));
  await prisma.run.update({ where: { id: runId }, data: { status: "PAUSED" } });
  revalidatePath("/admin");
}

export async function stopRunAction(formData: FormData) {
  const runId = String(formData.get("runId"));
  await prisma.run.update({
    where: { id: runId },
    data: { status: "STOPPED_MANUAL", endedAt: new Date() },
  });
  revalidatePath("/admin");
}
