import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type BoardConfirmRequest = {
  message: string;
  onYes: () => void;
};

/**
 * A drag never changes anything on its own: it asks the same question the
 * button on the task would ask, in the same words.
 */
export function BoardConfirm({
  request,
  onClose,
}: {
  request: BoardConfirmRequest | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>One moment</AlertDialogTitle>
          <AlertDialogDescription>{request?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Leave it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              request?.onYes();
              onClose();
            }}
          >
            Yes, do it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
