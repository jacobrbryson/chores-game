"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { Alert } from "@/components/alert";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import templateQuest from "@/assets/quests/template-quest.json";
import type { QuestChoice, QuestDefinition, QuestNode } from "@/lib/quests/types";

type FamilyQuestEditorClientProps = {
  questId?: string;
};

type ValidationState = {
  score: number;
  issues: string[];
};

function createQuestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `family-quest-${Date.now()}`;
}

function cloneTemplateQuest(): QuestDefinition {
  const quest = structuredClone(templateQuest) as QuestDefinition;
  const id = createQuestId();
  return {
    ...quest,
    id,
    slug: id,
    title: "Untitled Family Quest",
    subtitle: "A custom family adventure",
    author: "My Family",
    coverImage: "",
  };
}

function updateNode(quest: QuestDefinition, nodeId: string, updater: (node: QuestNode) => QuestNode) {
  return {
    ...quest,
    nodes: quest.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
  };
}

function choiceValue(choice: QuestChoice, key: keyof QuestChoice) {
  const value = choice[key];
  return typeof value === "string" ? value : "";
}

export function FamilyQuestEditorClient({ questId }: FamilyQuestEditorClientProps) {
  const [quest, setQuest] = useState<QuestDefinition>(() => cloneTemplateQuest());
  const [activeNodeId, setActiveNodeId] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ score: 0, issues: [] });
  const [showValidation, setShowValidation] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [nodeImageFiles, setNodeImageFiles] = useState<Record<string, File>>({});
  const [nodeAudioFiles, setNodeAudioFiles] = useState<Record<string, File>>({});
  const [loading, setLoading] = useState(Boolean(questId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!questId) {
      setActiveNodeId((current) => current || quest.startNodeId);
      return;
    }
    const resolvedQuestId = questId;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/family/quests/${encodeURIComponent(resolvedQuestId)}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP_${response.status}`);
        }
        const payload = (await response.json()) as { quest?: QuestDefinition };
        if (!cancelled && payload.quest) {
          setQuest(payload.quest);
          setActiveNodeId(payload.quest.startNodeId);
        }
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "family_quest_unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [questId]);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/family/quests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quest }),
        });
        const payload = (await response.json()) as { score?: number; issues?: string[]; detail?: string };
        setValidation({
          score: payload.score ?? 0,
          issues: payload.issues ?? (payload.detail ? [payload.detail] : []),
        });
      } catch {
        setValidation({ score: 0, issues: ["Could not validate quest right now."] });
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [quest]);

  const activeNode = useMemo(
    () => quest.nodes.find((node) => node.id === activeNodeId) ?? quest.nodes[0] ?? null,
    [activeNodeId, quest.nodes],
  );

  function setQuestField<K extends keyof QuestDefinition>(key: K, value: QuestDefinition[K]) {
    setQuest((current) => ({ ...current, [key]: value }));
  }

  function setActiveNodeField(key: "title" | "text" | "image" | "audio", value: string) {
    if (!activeNode) {
      return;
    }
    setQuest((current) => updateNode(current, activeNode.id, (node) => ({ ...node, [key]: value })));
  }

  function setChoiceField(choiceId: string, key: "label" | "description" | "requiredItemId" | "nextNodeId", value: string) {
    if (!activeNode || activeNode.type !== "story") {
      return;
    }
    setQuest((current) =>
      updateNode(current, activeNode.id, (node) => {
        if (node.type !== "story") {
          return node;
        }
        return {
          ...node,
          choices: node.choices.map((choice) => (choice.id === choiceId ? { ...choice, [key]: value } : choice)),
        };
      }),
    );
  }

  function onFileDrop(event: DragEvent<HTMLLabelElement>, kind: "cover" | "nodeImage" | "nodeAudio") {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file || !activeNode) {
      return;
    }
    if (kind === "cover") {
      setCoverFile(file);
    } else if (kind === "nodeImage") {
      setNodeImageFiles((current) => ({ ...current, [activeNode.id]: file }));
    } else {
      setNodeAudioFiles((current) => ({ ...current, [activeNode.id]: file }));
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>, kind: "cover" | "nodeImage" | "nodeAudio") {
    const file = event.target.files?.[0] ?? null;
    if (!file || !activeNode) {
      return;
    }
    if (kind === "cover") {
      setCoverFile(file);
    } else if (kind === "nodeImage") {
      setNodeImageFiles((current) => ({ ...current, [activeNode.id]: file }));
    } else {
      setNodeAudioFiles((current) => ({ ...current, [activeNode.id]: file }));
    }
  }

  async function saveQuest(publish: boolean) {
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const formData = new FormData();
      formData.set("quest", JSON.stringify(quest));
      formData.set("publish", publish ? "true" : "false");
      if (coverFile) {
        formData.set("coverImage", coverFile);
      }
      for (const [nodeId, file] of Object.entries(nodeImageFiles)) {
        formData.set(`nodeImage:${nodeId}`, file);
      }
      for (const [nodeId, file] of Object.entries(nodeAudioFiles)) {
        formData.set(`nodeAudio:${nodeId}`, file);
      }
      const response = await fetch("/api/family/quests", { method: "POST", body: formData });
      const payload = (await response.json()) as { error?: string; detail?: string; validation?: ValidationState };
      if (!response.ok) {
        throw new Error(payload.detail ?? payload.error ?? `HTTP_${response.status}`);
      }
      setCoverFile(null);
      setNodeImageFiles({});
      setNodeAudioFiles({});
      setSavedMessage(publish ? "Quest published." : "Draft saved.");
      if (publish) {
        setShowValidation(true);
      }
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "family_quest_save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="panel family-page family-quest-editor-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/family" />
          <h1>{questId ? "Edit Family Quest" : "New Family Quest"}</h1>
        </div>
        <div className="family-page-header-actions">
          <Button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void saveQuest(false)}>
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveQuest(true)}>
            Publish
          </Button>
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {savedMessage ? <Alert tone="success">{savedMessage}</Alert> : null}
      {loading ? (
        <section className="family-page-card">
          <div className="family-skeleton family-skeleton-title" />
          <div className="family-skeleton family-skeleton-row" />
        </section>
      ) : (
        <>
          <section className="family-quest-topbar">
            <Button type="button" className="family-quest-score" onClick={() => setShowValidation((open) => !open)}>
              <strong>{validation.score}/100</strong>
              <span>Rules score</span>
            </Button>
            <div className="family-quest-timeline" aria-label="Quest timeline">
              {quest.nodes.map((node, index) => (
                <Button
                  key={node.id}
                  type="button"
                  className={`family-quest-timeline-node${node.id === activeNode?.id ? " active" : ""}`}
                  onClick={() => setActiveNodeId(node.id)}>
                  <span>{index + 1}</span>
                  <strong>{node.title || node.id}</strong>
                  <small>{node.type}</small>
                </Button>
              ))}
            </div>
          </section>
          {showValidation ? (
            <section className="family-page-card family-quest-validation">
              <h2>Rules Feedback</h2>
              {validation.issues.length > 0 ? (
                <ul>
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="small">This quest currently meets the configured quest rules.</p>
              )}
            </section>
          ) : null}
          <section className="family-quest-editor-grid">
            <div className="family-page-card family-quest-form-card">
              <h2>Quest Details</h2>
              <label>
                <span>Title</span>
                <input value={quest.title} onChange={(event) => setQuestField("title", event.target.value)} />
              </label>
              <label>
                <span>Subtitle</span>
                <input value={quest.subtitle} onChange={(event) => setQuestField("subtitle", event.target.value)} />
              </label>
              <label>
                <span>Summary</span>
                <textarea value={quest.summary} onChange={(event) => setQuestField("summary", event.target.value)} />
              </label>
              <label>
                <span>Author</span>
                <input value={quest.author} onChange={(event) => setQuestField("author", event.target.value)} />
              </label>
              <label>
                <span>Age Range</span>
                <input value={quest.ageRange} onChange={(event) => setQuestField("ageRange", event.target.value)} />
              </label>
              <label>
                <span>Estimated Minutes</span>
                <input
                  type="number"
                  min={1}
                  value={quest.estimatedMinutes}
                  onChange={(event) => setQuestField("estimatedMinutes", Number(event.target.value) || 1)}
                />
              </label>
              <label className="family-quest-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onFileDrop(event, "cover")}>
                <span>Cover Image</span>
                <input type="file" accept="image/*" onChange={(event) => onFileChange(event, "cover")} />
                <strong>{coverFile?.name || quest.coverImage || "Upload or drag an image"}</strong>
              </label>
            </div>
            <div className="family-page-card family-quest-form-card family-quest-page-editor">
              <h2>{activeNode?.title || "Quest Page"}</h2>
              {activeNode ? (
                <>
                  <label>
                    <span>Page Title</span>
                    <input value={activeNode.title} onChange={(event) => setActiveNodeField("title", event.target.value)} />
                  </label>
                  <label>
                    <span>Page Text</span>
                    <textarea value={activeNode.text} onChange={(event) => setActiveNodeField("text", event.target.value)} />
                  </label>
                  <div className="family-quest-upload-row">
                    <label className="family-quest-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onFileDrop(event, "nodeImage")}>
                      <span>Page Image</span>
                      <input type="file" accept="image/*" onChange={(event) => onFileChange(event, "nodeImage")} />
                      <strong>{nodeImageFiles[activeNode.id]?.name || activeNode.image || "Upload or drag image"}</strong>
                    </label>
                    <label className="family-quest-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onFileDrop(event, "nodeAudio")}>
                      <span>MP3 Audio</span>
                      <input type="file" accept="audio/mpeg,audio/mp3" onChange={(event) => onFileChange(event, "nodeAudio")} />
                      <strong>{nodeAudioFiles[activeNode.id]?.name || activeNode.audio || "Upload or drag MP3"}</strong>
                    </label>
                  </div>
                  {activeNode.type === "story" ? (
                    <div className="family-quest-choice-list">
                      <h3>Choices</h3>
                      {activeNode.choices.map((choice) => (
                        <div key={choice.id} className="family-quest-choice-card">
                          <label>
                            <span>Label</span>
                            <input value={choice.label} onChange={(event) => setChoiceField(choice.id, "label", event.target.value)} />
                          </label>
                          <label>
                            <span>Description</span>
                            <input value={choice.description} onChange={(event) => setChoiceField(choice.id, "description", event.target.value)} />
                          </label>
                          <label>
                            <span>Required Item ID</span>
                            <input value={choiceValue(choice, "requiredItemId")} onChange={(event) => setChoiceField(choice.id, "requiredItemId", event.target.value)} />
                          </label>
                          <label>
                            <span>Next Page</span>
                            <select value={choice.nextNodeId} onChange={(event) => setChoiceField(choice.id, "nextNodeId", event.target.value)}>
                              {quest.nodes.map((node) => (
                                <option key={node.id} value={node.id}>
                                  {node.title || node.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Alert tone="info">Ending reward fields use the template defaults for now.</Alert>
                  )}
                </>
              ) : null}
            </div>
          </section>
          <p className="small">
            Published quests appear in <Link href="/quests">Quests</Link> for every family member.
          </p>
        </>
      )}
    </main>
  );
}
