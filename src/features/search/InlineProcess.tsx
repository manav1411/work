import { useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  field,
  localDate,
  type RecordData,
  type WorkRecord,
} from "../../../shared/model";
import {
  ApplicationDataSchema,
  STEP_STATES,
  applicationStatus,
  archiveRecruitmentStep,
  changeRecruitmentStep,
  currentRecruitmentStep,
  editableApplicationData,
  recruitmentSteps,
  type RecruitmentStep,
} from "../../../shared/applications";
import { Button, Select } from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import { interviewTime } from "./applicationRecords";
import { errorMessage } from "./domain";
import { InlineTitle } from "../content/InlineTitle";

const horizontalOnly: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

export function InlineProcess({
  record,
  interviews,
}: {
  record: WorkRecord;
  interviews: WorkRecord[];
}) {
  const { editing } = useEditMode();
  const { update, preferences, pending } = useWorkspace();
  const [error, setError] = useState("");
  const [optimistic, setOptimistic] = useState<RecordData>();
  const sourceVersion = useRef(record.version);
  if (sourceVersion.current !== record.version) {
    sourceVersion.current = record.version;
    if (optimistic) setOptimistic(undefined);
  }
  const data = optimistic || record.data;
  const draft = { ...record, data };
  const steps = recruitmentSteps(data);
  const allSteps = recruitmentSteps(data, true);
  const active = currentRecruitmentStep(draft);
  const modern = data.processVersion === 2;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  async function persist(next: RecordData, propagate = false) {
    try {
      setError("");
      const validated = ApplicationDataSchema.parse(next);
      setOptimistic(validated);
      return await update(record.id, { data: validated }, record.version);
    } catch (failure) {
      setOptimistic(undefined);
      setError(errorMessage(failure));
      if (propagate) throw failure;
    }
  }
  function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const intermediate = steps.filter(
      (step) => !["submission", "offer"].includes(step.kind),
    );
    const from = intermediate.findIndex((step) => step.id === event.active.id),
      to = intermediate.findIndex((step) => step.id === event.over?.id);
    if (from < 0 || to < 0) return;
    if (intermediate[from].state !== intermediate[to].state) {
      setError(
        "Keep completed steps together. Mark a step Planned before moving it across the completion boundary.",
      );
      return;
    }
    const reordered = arrayMove(intermediate, from, to);
    const next = [steps[0], ...reordered, steps.at(-1)!];
    // Only reorder within the completed or planned group; do not invent completion.
    const completed = steps.filter((step) => step.state === "Completed").length;
    const ordered = next.map((step, index) => ({
      ...step,
      state: index < completed ? ("Completed" as const) : ("Planned" as const),
    }));
    const first = ordered.find((step) => step.state === "Planned");
    void persist({
      ...data,
      recruitmentSteps: [
        ...ordered,
        ...allSteps.filter((step) => step.archived),
      ],
      selectedStepId:
        applicationStatus(draft) !== "Applied" &&
        first &&
        !["submission", "offer"].includes(first.kind)
          ? first.id
          : "",
    });
  }
  return (
    <div className="application-process-inline">
      {!modern && editing && (
        <Button
          variant="secondary"
          onClick={() => void persist(editableApplicationData(record))}
        >
          Edit process
        </Button>
      )}
      {!modern && (
        <p className="muted application-legacy-label">
          Historical process · original states are retained until explicitly
          edited.
        </p>
      )}
      {!steps.length && <p className="muted">No process outlined yet.</p>}
      <DndContext
        sensors={sensors}
        modifiers={[horizontalOnly]}
        collisionDetection={closestCenter}
        onDragEnd={reorder}
      >
        <SortableContext
          items={steps
            .filter((step) => !["submission", "offer"].includes(step.kind))
            .map((step) => step.id)}
          strategy={horizontalListSortingStrategy}
        >
          <ol className="recruitment-timeline">
            {steps.map((step, index) => (
              <ProcessStep
                key={step.id}
                step={step}
                applicationId={record.id}
                index={index}
                active={active?.id === step.id}
                editing={editing && modern}
                pending={!!pending}
                appointments={interviews.filter(
                  (interview) => field(interview, "stepId") === step.id,
                )}
                timezone={preferences.timezone}
                rename={(title) =>
                  persist(
                    {
                      ...data,
                      recruitmentSteps: allSteps.map((item) =>
                        item.id === step.id
                          ? { ...item, title: title.trim() || "Untitled" }
                          : item,
                      ),
                    },
                    true,
                  )
                }
                change={(state) => {
                  try {
                    void persist(
                      changeRecruitmentStep(
                        draft,
                        step.id,
                        state,
                        localDate(new Date(), preferences.timezone),
                      ),
                    );
                  } catch (failure) {
                    setError(errorMessage(failure));
                  }
                }}
                remove={() => {
                  try {
                    void persist(archiveRecruitmentStep(draft, step.id));
                  } catch (failure) {
                    setError(errorMessage(failure));
                  }
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {editing && modern && (
        <Button
          variant="secondary"
          disabled={!!pending || allSteps.length >= 80}
          onClick={() => {
            if (["Offer", "Accepted"].includes(applicationStatus(draft))) {
              setError(
                "Change the status to a recruitment step before extending a completed process.",
              );
              return;
            }
            const next = [...allSteps];
            const offerIndex = next.findIndex(
              (step) => !step.archived && step.kind === "offer",
            );
            const added: RecruitmentStep = {
              id: crypto.randomUUID(),
              title: "Untitled",
              kind: "other",
              state: "Planned",
              date: "",
            };
            next.splice(offerIndex, 0, added);
            const first = next.find(
              (step) => !step.archived && step.state === "Planned",
            );
            void persist({
              ...data,
              recruitmentSteps: next,
              selectedStepId:
                data.selectedStepId ||
                (applicationStatus(draft) === "In progress" &&
                first?.id === added.id
                  ? added.id
                  : ""),
            });
          }}
        >
          <Plus size={15} />
          Add step
        </Button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}

function ProcessStep({
  step,
  applicationId,
  index,
  active,
  editing,
  pending,
  appointments,
  timezone,
  rename,
  change,
  remove,
}: {
  step: RecruitmentStep;
  applicationId: string;
  index: number;
  active: boolean;
  editing: boolean;
  pending: boolean;
  appointments: WorkRecord[];
  timezone: string;
  rename: (title: string) => Promise<unknown>;
  change: (state: RecruitmentStep["state"]) => void;
  remove: () => void;
}) {
  const intermediate = !["submission", "offer"].includes(step.kind);
  const sortable = useSortable({
    id: step.id,
    disabled: !editing || !intermediate || pending,
  });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.55 : 1,
      }}
      className={`recruitment-step ${step.state === "Completed" ? "recruitment-completed" : active ? "recruitment-current" : ""}`}
    >
      <div className="recruitment-step-heading">
        <span className="recruitment-step-number">{index + 1}</span>
        {editing && intermediate && (
          <button
            type="button"
            className="process-drag-handle"
            aria-label={`Rearrange ${step.title}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={15} />
          </button>
        )}
      </div>
      {editing && intermediate ? (
        <InlineTitle
          draftKey={`process-step-title:${applicationId}:${step.id}`}
          label="Step name"
          autoFocus={step.title === "Untitled"}
          value={step.title}
          onSave={rename}
        />
      ) : (
        <strong>{step.title}</strong>
      )}
      {editing ? (
        <Select
          disabled={pending}
          aria-label={`${step.title} state`}
          value={step.state}
          onChange={(event) =>
            change(event.target.value as RecruitmentStep["state"])
          }
        >
          {STEP_STATES.map((state) => (
            <option key={state}>{state}</option>
          ))}
        </Select>
      ) : (
        <small>{step.state}</small>
      )}
      {appointments.map((appointment) => (
        <small className="recruitment-appointment" key={appointment.id}>
          {interviewTime(appointment, timezone)}
        </small>
      ))}
      {editing && intermediate && (
        <Button
          variant="ghost"
          disabled={pending}
          aria-label={`Delete ${step.title}`}
          onClick={remove}
        >
          <Trash2 size={15} />
        </Button>
      )}
    </li>
  );
}
