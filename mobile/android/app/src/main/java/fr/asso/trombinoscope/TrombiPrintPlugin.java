package fr.asso.trombinoscope;

import android.content.Context;
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
}
