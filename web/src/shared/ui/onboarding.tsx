/**
 * Adapted from Cult UI's Onboarding primitives (controlled steps only).
 * https://github.com/nolly-studio/cult-ui/blob/main/apps/www/registry/default/ui/onboarding.tsx
 * MIT License — Copyright (c) 2023 Jordan-Gilliam
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  createContext,
  useContext,
  type ReactNode,
  type ComponentProps,
} from "react";
import { cn } from "@/shared/lib/cn";

const Context = createContext({ currentStep: 1, totalSteps: 2 });

function Root({
  value,
  totalSteps,
  className,
  children,
  ...props
}: ComponentProps<"section"> & {
  value: number;
  totalSteps: number;
}) {
  return (
    <Context.Provider value={{ currentStep: value, totalSteps }}>
      <section
        {...props}
        className={cn("hive-onboarding-content", className)}
        data-slot="onboarding"
        data-state={`step-${value}`}
      >
        {children}
      </section>
    </Context.Provider>
  );
}

function Step({ step, children }: { step: number; children: ReactNode }) {
  const { currentStep } = useContext(Context);
  return currentStep === step ? (
    <div data-slot="onboarding-step">{children}</div>
  ) : null;
}

function Header({ children }: { children: ReactNode }) {
  return <header data-slot="onboarding-header">{children}</header>;
}

function StepIndicator() {
  const { currentStep, totalSteps } = useContext(Context);
  return (
    <div
      role="progressbar"
      aria-label={`Step ${currentStep} of ${totalSteps}`}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentStep}
      data-slot="onboarding-step-indicator"
    >
      {Array.from({ length: totalSteps }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed sequential progress markers never reorder.
          key={i + 1}
          data-state={
            i + 1 === currentStep
              ? "active"
              : i + 1 < currentStep
                ? "completed"
                : "inactive"
          }
        />
      ))}
    </div>
  );
}

function Navigation({ children, ...props }: ComponentProps<"fieldset">) {
  return (
    <fieldset
      aria-label="Onboarding navigation"
      data-slot="onboarding-navigation"
      {...props}
    >
      {children}
    </fieldset>
  );
}

/** Controlled presentation; the caller owns validation and asynchronous persistence. */
export const Onboarding = Object.assign(Root, {
  Step,
  Header,
  StepIndicator,
  Navigation,
});
