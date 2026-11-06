import { Link } from "react-router";

export function F1Header() {
  return (
    <header className="f1-navy-bg border-b-4 border-f1-brand">
      <div className="h-1.5 fit:h-1 w-full bg-gradient-to-r from-f1-brand via-white to-f1-brand" />
      <div className="flex w-full items-center gap-3 px-6 py-3 lg:px-12 fit:px-8 fit:py-1.5">
        <span className="f1-font-display flex h-9 w-9 fit:h-7 fit:w-7 items-center justify-center rounded-sm bg-f1-brand text-sm font-bold text-f1-ink">
          04
        </span>
        <Link to="/" className="f1-font-display text-xl fit:text-lg font-bold tracking-wide text-white">
          I-DOJO <span className="text-f1-brand-bright">PIT 4</span>
          <span className="ml-2 hidden text-sm font-medium text-zinc-300 sm:inline">5S</span>
        </Link>
        <nav className="f1-font-display ml-auto flex gap-4 text-sm font-medium tracking-wide text-zinc-300">
          <Link to="/" className="hover:text-white">
            เล่นเกม
          </Link>
          <Link to="/editor" className="hover:text-white">
            แก้ไขโจทย์
          </Link>
        </nav>
      </div>
    </header>
  );
}
