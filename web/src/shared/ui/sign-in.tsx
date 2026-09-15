import type { ReactNode } from "react";
import "@/shared/styles/account-entry.css";

/** Split sign-in layout adapted from the supplied component; authentication stays with the caller. */
export function SignInPage({
  brand,
  title,
  description,
  heroImageSrc,
  children,
}: {
  brand: ReactNode;
  title: ReactNode;
  description: string;
  heroImageSrc: string;
  children: ReactNode;
}) {
  return (
    <main className="hive-app hive-sign-in">
      <section className="hive-sign-in-panel" aria-labelledby="sign-in-title">
        <div className="hive-sign-in-form">
          <div className="hive-sign-in-brand">{brand}</div>
          <h1 id="sign-in-title" className="sr-only">
            {title}
          </h1>
          <p className="hive-sign-in-description">{description}</p>
          {children}
        </div>
        <footer className="hive-sign-in-footer">
          <span>Good things get built together.</span>
          <a href="https://creatorhive.ai">
            Explore the Hive <span aria-hidden="true">↗</span>
          </a>
        </footer>
      </section>
      <aside className="hive-sign-in-hero" aria-label="Inside the Hive">
        <img src={heroImageSrc} alt="" fetchPriority="high" />
        <div className="hive-sign-in-caption">
          <p>THE CREATORHIVE WORKSHOP</p>
          <h2>
            A little curiosity.
            <br />A lot of possibility.
          </h2>
          <p>
            Meet the people behind the projects. Watch the work happen. Build
            something together.
          </p>
        </div>
      </aside>
    </main>
  );
}
