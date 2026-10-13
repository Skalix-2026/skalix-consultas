import { CLASSES_TOM, type Tom } from "@/lib/ui/status";

export function Badge({ rotulo, tom }: { rotulo: string; tom: Tom }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES_TOM[tom]}`}>
      {rotulo}
    </span>
  );
}
