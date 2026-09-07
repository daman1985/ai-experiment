import { loginAction } from "../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-sm">
        <form action={loginAction} className="space-y-4">
          <h1 className="font-serif text-xl text-text-primary">Admin sign-in</h1>
          {error && (
            <Badge variant="error">
              <span className="font-normal">Incorrect password.</span>
            </Badge>
          )}
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-text-secondary">
              Password
            </label>
            <Input id="password" name="password" type="password" required autoFocus />
          </div>
          <Button type="submit" variant="primary" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
