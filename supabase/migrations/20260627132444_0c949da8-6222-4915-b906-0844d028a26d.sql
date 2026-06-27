
CREATE POLICY "Staff read kyc-docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE POLICY "Staff upload kyc-docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc-docs' AND public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE POLICY "Staff delete kyc-docs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
