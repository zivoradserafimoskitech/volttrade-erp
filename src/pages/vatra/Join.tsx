import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Public Vatra landing lead form — no auth. Octopus-style: minimal fields so
 * the barrier is low. POD/EIC and tax id are collected LATER (at contract),
 * not here. Submits to submit-lead edge function → leads table + confirmation.
 */
export default function VatraJoin() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<"household" | "business">("household");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!email.trim() && !phone.trim())) {
      return toast.error("Внесете име и барем еден контакт.");
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-lead", {
        body: { contact_name: name, contact_email: email, contact_phone: phone, consumer_type: type, company_name: type === "business" ? company : "" },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Неуспешно испраќање");
      setDone((data as any).message ?? "Барањето е испратено.");
    } catch (err: any) {
      toast.error(err?.message ?? "Неуспешно испраќање");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#1a1510", color: "#fff", fontFamily: "sans-serif", padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 26, marginBottom: 6 }}>vatra<span style={{ color: "#FF6B2C" }}>.</span></div>
          <div style={{ fontSize: 44, marginBottom: 12 }}>✓</div>
          <h1 style={{ fontSize: 22, marginBottom: 10 }}>Благодариме!</h1>
          <p style={{ color: "#bbb", lineHeight: 1.5 }}>{done}</p>
          <Link to="/how" style={{ color: "#FF6B2C", display: "inline-block", marginTop: 20 }}>Како функционира Vatra?</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#1a1510", color: "#fff", fontFamily: "sans-serif", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 26 }}>vatra<span style={{ color: "#FF6B2C" }}>.</span></div>
          <div style={{ letterSpacing: ".18em", fontSize: 12, color: "#999", textTransform: "uppercase" }}>Your Energy</div>
        </div>
        <div style={{ background: "#221c15", border: "1px solid #342c22", borderRadius: 18, padding: 28 }}>
          <h1 style={{ fontSize: 22, marginBottom: 6 }}>Приклучете се кон Vatra</h1>
          <p style={{ color: "#aaa", fontSize: 14, marginBottom: 20 }}>Оставете ги вашите податоци и наш претставник ќе ве контактира со најдобрата понуда. Без обврска.</p>
          <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {(["household", "business"] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700,
                    border: type === t ? "2px solid #FF6B2C" : "1px solid #342c22",
                    background: type === t ? "#2a2018" : "transparent", color: "#fff" }}>
                  {t === "household" ? "Домаќинство" : "Фирма"}
                </button>
              ))}
            </div>
            <div><Label style={{ color: "#ccc" }}>Име и презиме</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Име Презиме" style={{ marginTop: 4 }} /></div>
            {type === "business" && (
              <div><Label style={{ color: "#ccc" }}>Име на фирма</Label>
                <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Фирма ДООЕЛ" style={{ marginTop: 4 }} /></div>
            )}
            <div><Label style={{ color: "#ccc" }}>Е-пошта</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vashe@email.com" style={{ marginTop: 4 }} /></div>
            <div><Label style={{ color: "#ccc" }}>Телефон</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="07X XXX XXX" style={{ marginTop: 4 }} /></div>
            <Button type="submit" disabled={busy}
              style={{ background: "#FF6B2C", color: "#1a1510", fontWeight: 800, minHeight: 48, marginTop: 4 }}>
              {busy ? "Се испраќа…" : "Испрати барање"}
            </Button>
            <p style={{ color: "#777", fontSize: 12, textAlign: "center", margin: 0 }}>
              Со испраќање се согласувате Vatra да ве контактира во врска со вашето барање.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
