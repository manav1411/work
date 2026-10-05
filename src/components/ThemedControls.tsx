import {
  Children,
  isValidElement,
  useState,
  useRef,
  type ReactNode,
  type SelectHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type Ref,
  type ButtonHTMLAttributes,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import "./themed-controls.css";

function options(
  children: ReactNode,
): Array<{ value: string; label: ReactNode; disabled?: boolean }> {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    return child.type === "option"
      ? [
          {
            value: String(child.props.value ?? child.props.children ?? ""),
            label: child.props.children,
            disabled: child.props.disabled,
          },
        ]
      : options(child.props.children);
  });
}
const empty = "__work_empty_selection__";
export function ThemedSelect({
  children,
  value,
  defaultValue,
  onChange,
  className = "",
  id,
  name,
  required,
  disabled,
  "aria-label": label,
  "aria-describedby": described,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const choices = options(children);
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  return (
    <SelectPrimitive.Root
      value={value === undefined ? undefined : String(value)}
      defaultValue={
        defaultValue === undefined ? undefined : String(defaultValue)
      }
      name={name}
      required={required}
      disabled={disabled}
      onOpenChange={() =>
        setPortalContainer(trigger.current?.closest("dialog") ?? null)
      }
      onValueChange={(v) => {
        const selected = v === empty ? "" : v;
        onChange?.({
          target: { value: selected, name },
          currentTarget: { value: selected, name },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        {...(props as unknown as ButtonHTMLAttributes<HTMLButtonElement>)}
        id={id}
        aria-label={label}
        aria-describedby={described}
        className={`input select themed-select-trigger ${className}`}
        onBlur={
          props.onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>
        }
      >
        <SelectPrimitive.Value
          placeholder={choices.find((choice) => !choice.value)?.label}
        />
        <SelectPrimitive.Icon>
          <ChevronDown size={15} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer ?? undefined}>
        <SelectPrimitive.Content
          className="themed-select-content"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
        >
          <SelectPrimitive.Viewport>
            {choices.map((choice, index) => (
              <SelectPrimitive.Item
                key={`${choice.value}:${index}`}
                value={choice.value || empty}
                disabled={choice.disabled}
                className="themed-select-item"
              >
                <SelectPrimitive.ItemText>
                  {choice.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function DateInput({
  inputRef,
  type,
  value,
  onChange,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: Ref<HTMLInputElement>;
}) {
  const initial = String(value || "");
  const [open, setOpen] = useState(false);
  const calendar = useRef<HTMLDivElement>(null);
  const dateTrigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [hour, setHour] = useState(initial.slice(11, 13) || "09");
  const [minute, setMinute] = useState(initial.slice(14, 16) || "00");
  const [month, setMonth] = useState(() => {
    const d = new Date(
      `${initial.slice(0, 10) || new Date().toISOString().slice(0, 10)}T12:00:00`,
    );
    return Number.isFinite(d.getTime())
      ? new Date(d.getFullYear(), d.getMonth(), 1)
      : new Date();
  });
  const update = (next: string) =>
    onChange?.({
      target: { value: next, name: props.name },
      currentTarget: { value: next, name: props.name },
    } as ChangeEvent<HTMLInputElement>);
  const datetime = type === "datetime-local";
  const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const chosen = initial.slice(0, 10);
  const dateFor = (day: number) =>
    `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const commitTime = () => {
    if (
      !/^\d{1,2}$/.test(hour) ||
      Number(hour) > 23 ||
      !/^\d{1,2}$/.test(minute) ||
      Number(minute) > 59
    )
      return;
    update(
      `${chosen || dateFor(Math.min(new Date().getDate(), days))}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
    );
  };
  return (
    <div className="themed-date">
      <input
        {...props}
        ref={inputRef}
        type="text"
        className={`input ${className}`}
        value={value}
        onChange={onChange}
        placeholder={
          props.placeholder || (datetime ? "YYYY-MM-DDTHH:MM" : "YYYY-MM-DD")
        }
      />
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setPortalContainer(dateTrigger.current?.closest("dialog") ?? null);
            setHour(initial.slice(11, 13) || "09");
            setMinute(initial.slice(14, 16) || "00");
            const selected = new Date(`${chosen}T12:00:00`);
            if (Number.isFinite(selected.getTime()))
              setMonth(
                new Date(selected.getFullYear(), selected.getMonth(), 1),
              );
          }
          setOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <button
            ref={dateTrigger}
            type="button"
            className="date-trigger"
            disabled={props.disabled || props.readOnly}
            aria-label={`Choose ${datetime ? "date and time" : "date"}`}
          >
            <CalendarDays size={17} />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer ?? undefined}>
          <Popover.Content
            ref={calendar}
            sideOffset={6}
            collisionPadding={12}
            className="themed-calendar"
          >
            <div className="calendar-heading">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  )
                }
              >
                <ChevronLeft size={16} />
              </button>
              <strong>
                {month.toLocaleDateString("en-AU", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                type="button"
                aria-label="Next month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  )
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="calendar-grid">
              {"SMTWTFS".split("").map((day, i) => (
                <span key={i}>{day}</span>
              ))}
              {Array.from({ length: first }, (_, i) => (
                <i key={`blank${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = dateFor(i + 1);
                return (
                  <button
                    type="button"
                    key={date}
                    aria-label={date}
                    aria-pressed={chosen === date}
                    onKeyDown={(event) => {
                      const offsets: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                      };
                      if (!(event.key in offsets)) return;
                      event.preventDefault();
                      const destination = new Date(`${date}T12:00:00`);
                      destination.setDate(
                        destination.getDate() + offsets[event.key],
                      );
                      const target = `${destination.getFullYear()}-${String(destination.getMonth() + 1).padStart(2, "0")}-${String(destination.getDate()).padStart(2, "0")}`;
                      if (
                        (props.min &&
                          target < String(props.min).slice(0, 10)) ||
                        (props.max && target > String(props.max).slice(0, 10))
                      )
                        return;
                      setMonth(
                        new Date(
                          destination.getFullYear(),
                          destination.getMonth(),
                          1,
                        ),
                      );
                      requestAnimationFrame(() =>
                        calendar.current
                          ?.querySelector<HTMLButtonElement>(
                            `button[aria-label="${target}"]`,
                          )
                          ?.focus(),
                      );
                    }}
                    disabled={Boolean(
                      (props.min && date < String(props.min).slice(0, 10)) ||
                      (props.max && date > String(props.max).slice(0, 10)),
                    )}
                    onClick={() => {
                      update(
                        datetime
                          ? `${date}T${initial.slice(11, 16) || "09:00"}`
                          : date,
                      );
                      if (!datetime) setOpen(false);
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            {datetime && (
              <div className="calendar-time">
                <label>
                  Hour
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={hour}
                    onChange={(e) => {
                      const h = e.target.value;
                      if (/^\d{0,2}$/.test(h) && Number(h) < 24) setHour(h);
                    }}
                    onBlur={commitTime}
                  />
                </label>
                <label>
                  Minute
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={minute}
                    onChange={(e) => {
                      const m = e.target.value;
                      if (/^\d{0,2}$/.test(m) && Number(m) < 60) setMinute(m);
                    }}
                    onBlur={commitTime}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    commitTime();
                    setOpen(false);
                  }}
                >
                  Done
                </button>
              </div>
            )}
            {!props.required && (
              <button
                type="button"
                className="calendar-clear"
                onClick={() => {
                  update("");
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
