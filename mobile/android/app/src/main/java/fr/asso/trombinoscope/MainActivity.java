package fr.asso.trombinoscope;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrombiPrintPlugin.class);   // impression (voir TrombiPrintPlugin)
        super.onCreate(savedInstanceState);
    }
}
