package fr.asso.trombinoscope;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import java.io.OutputStream;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Impression du trombinoscope : ouvre la fenêtre d'impression d'Android sur la page affichée
 * (styles @media print de la page, format A4). Permet aussi « Enregistrer au format PDF ».
 *
 * La promesse n'est résolue qu'à la FERMETURE de la fenêtre d'impression : la page ne doit afficher
 * aucune boîte de dialogue pendant ce temps, sinon le rendu de la page (et donc l'aperçu) est bloqué.
 */
@CapacitorPlugin(name = "TrombiPrint")
public class TrombiPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Trombinoscope");
        String jobName = (name == null || name.trim().isEmpty() ? "Trombinoscope" : name.trim())
                .replaceAll("[\\\\/:*?\"<>|]", " ");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                WebView webView = getBridge().getWebView();
                PrintDocumentAdapter inner = webView.createPrintDocumentAdapter(jobName);
                final PrintJob[] job = new PrintJob[1];
                PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                    @Override public void onStart() { inner.onStart(); }
                    @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                                   CancellationSignal cancellationSignal, LayoutResultCallback callback, Bundle extras) {
                        inner.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
                    }
                    @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                                  CancellationSignal cancellationSignal, WriteResultCallback callback) {
                        inner.onWrite(pages, destination, cancellationSignal, callback);
                    }
                    @Override public void onFinish() {
                        inner.onFinish();
                        // fenêtre fermée : annulée, ou envoyée à l'imprimante / enregistrée en PDF.
                        // Android met à jour l'état du travail juste après : on le lit un peu plus tard.
                        new Handler(Looper.getMainLooper()).postDelayed(() -> {
                            PrintJob j = job[0];
                            boolean done = j != null && (j.isQueued() || j.isStarted() || j.isCompleted() || j.isBlocked());
                            JSObject result = new JSObject();
                            result.put("done", done);
                            result.put("state", j == null ? -1 : j.getInfo().getState());
                            call.resolve(result);
                        }, 700);
                    }
                };
                PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .build();
                job[0] = printManager.print(jobName, adapter, attributes);
            } catch (Exception e) {
                call.reject("Impression impossible : " + e.getMessage(), e);
            }
        });
    }

    /** PDF en attente d'enregistrement (le temps que l'utilisateur choisisse l'emplacement). */
    private byte[] pendingPdf;

    /** Export PDF : ouvre la fenêtre « Enregistrer sous » d'Android, puis écrit le fichier choisi. */
    @PluginMethod
    public void savePdf(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "Trombinoscope.pdf");
        if (data == null || data.isEmpty()) { call.reject("PDF vide"); return; }
        try {
            pendingPdf = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("PDF invalide"); return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, name.replaceAll("[\\\\/:*?\"<>|]", " "));
        startActivityForResult(call, intent, "pdfSaved");
    }

    @ActivityCallback
    private void pdfSaved(PluginCall call, ActivityResult result) {
        byte[] pdf = pendingPdf;
        pendingPdf = null;
        if (call == null) return;
        JSObject ret = new JSObject();
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || pdf == null) {
            ret.put("saved", false);   // annulé par l'utilisateur
            call.resolve(ret);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new Exception("fichier inaccessible");
            out.write(pdf);
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Enregistrement impossible : " + e.getMessage(), e);
        }
    }
}
