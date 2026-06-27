import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export default function PortalProfile() {
  const { user } = useAuth();
  const [client, setClient] = useState<any>(null);
  useEffect(() => { (async () => {
    if (!user) return;
    const { data } = await supabase.from("clients").select("*").eq("portal_user_id", user.id).maybeSingle();
    setClient(data);
  })(); }, [user]);

  const save = async (form: FormData) => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({
      contact_name: form.get("contact_name") as string,
      contact_email: form.get("contact_email") as string,
      contact_phone: form.get("contact_phone") as string,
    }).eq("id", client.id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };
  const changePass = async (form: FormData) => {
    const pw = String(form.get("password"));
    if (pw.length < 8) return toast.error("Min 8 characters");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return toast.error(error.message);
    toast.success("Password updated");
  };
  if (!client) return <PortalLayout title="Profile"><div className="text-sm text-muted-foreground">Not linked.</div></PortalLayout>;
  return (
    <PortalLayout title="Profile">
      <Card className="border-border/60"><CardContent className="p-4 space-y-3">
        <div className="text-sm font-medium">Company contact</div>
        <form onSubmit={e => { e.preventDefault(); save(new FormData(e.currentTarget)); }} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-2"><Label>Name</Label><Input name="contact_name" defaultValue={client.contact_name ?? ""} /></div>
          <div className="space-y-2"><Label>Email</Label><Input name="contact_email" type="email" defaultValue={client.contact_email ?? ""} /></div>
          <div className="space-y-2"><Label>Phone</Label><Input name="contact_phone" defaultValue={client.contact_phone ?? ""} /></div>
          <Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save</Button>
        </form>
      </CardContent></Card>
      <Card className="border-border/60"><CardContent className="p-4 space-y-3">
        <div className="text-sm font-medium">Change password</div>
        <form onSubmit={e => { e.preventDefault(); changePass(new FormData(e.currentTarget)); }} className="flex gap-3 items-end">
          <div className="space-y-2 flex-1"><Label>New password</Label><Input name="password" type="password" minLength={8} required /></div>
          <Button type="submit">Update</Button>
        </form>
      </CardContent></Card>
    </PortalLayout>
  );
}