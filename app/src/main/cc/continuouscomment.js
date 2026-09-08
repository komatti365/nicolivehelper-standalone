/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

var ContinuousComment = {

    sendLine: function(){
        var str;
        str = document.getElementById( 'multiline-comment' ).value.split( /\n|\r|\r\n/ );
        if( str.length ){
            let cmd = document.getElementById( 'multiline-command' ).value;
            let comment = str[0];

            comment = comment.replace( /\\([\\n])/g, function( s, p ){
                switch( p ){
                case "n":
                    return "\n";
                case "\\":
                    return "\\";
                default:
                    return s;
                }
            } );
            if( comment.indexOf( "/" ) == 0 ){
                let tmp = comment.split( "/" );
                cmd += " " + tmp[1];
                tmp.splice( 0, 2 );
                comment = tmp.join( "/" );
            }
            opener.NicoLiveComment.sendCommentCore( comment, cmd );

            str.splice( 0, 1 );
            document.getElementById( 'multiline-comment' ).value = str.join( '\r\n' );
        }else{
        }
    },

    dropFile: function( ev ){
        console.log( ev.dataTransfer );

        if( ev.dataTransfer.items ){
            // Use DataTransferItemList interface to access the file(s)
            for( var i = 0; i < ev.dataTransfer.items.length; i++ ){
                // If dropped items aren't files, reject them
                if( ev.dataTransfer.items[i].kind === 'file' ){
                    var file = ev.dataTransfer.items[i].getAsFile();
                    console.log( '... file[' + i + '].name = ' + file.name );
                    if( file.name.match( /\.txt$/ ) ){
                        let fileReader = new FileReader();
                        fileReader.onload = ( ev ) =>{
                            let txt = ev.target.result;
                            $( '#multiline-comment' ).val( txt );

                            // IndexedDBにファイルを保存
                            this.db.ccfile.put( {
                                filename: file.name,
                                text: txt
                            } );

                            let sel = $( '#sel-file' );
                            let option = document.createElement( 'option' );
                            $( option ).text( file.name );
                            $( option ).val( file.name );
                            sel.append( option );
                        };
                        fileReader.readAsText( file );
                    }
                }
            }
            return;
        }else{
            // Use DataTransfer interface to access the file(s)
            for( var i = 0; i < ev.dataTransfer.files.length; i++ ){
                console.log( '... file[' + i + '].name = ' + ev.dataTransfer.files[i].name );
                let file = ev.dataTransfer.files[i];
                if( file.name.match( /\.txt$/ ) ){
                    let fileReader = new FileReader();
                    fileReader.onload = ( ev ) =>{
                        let txt = ev.target.result;
                        $( '#multiline-comment' ).val( txt );

                        // IndexedDBにファイルを保存
                        this.db.ccfile.put( {
                            filename: file.name,
                            text: txt
                        } );

                        let sel = $( '#sel-file' );
                        let option = document.createElement( 'option' );
                        $( option ).text( file.name );
                        $( option ).val( file.name );
                        sel.append( option );
                    };
                    fileReader.readAsText( file );
                }
            }
            return;
        }
    },

    initDB: function(){
        this.db = CCDB.initDB();
    },

    loadDB: async function(){
        let result = await this.db.ccfile.toArray();

        let sel = $( '#sel-file' );
        for( let f of result ){
            let option = document.createElement( 'option' );
            $( option ).text( f.filename );
            $( option ).val( f.filename );
            sel.append( option );
        }
    },

    init: function(){
        try{
            document.title = `連続コメント ${window.opener.NicoLiveHelper.getLiveId()}`;
        }catch( e ){
        }

        this.initDB();
        this.loadDB();

        $( '#sel-file' ).on( 'change', async ( ev ) =>{
            let file = $( '#sel-file' ).val();
            let text = await this.db.ccfile.get( {filename: file} );
            text = text || '';
            $( '#multiline-comment' ).val( text.text );
        } );

        $( '#save-text' ).on( 'click', ( ev ) =>{
            let name = window.prompt( '名前を入力してください', $( '#sel-file' ).val() || 'noname' );
            if( !name ) return;
            this.db.ccfile.put( {
                filename: name,
                text: $( '#multiline-comment' ).val()
            } );

            let sel = $( '#sel-file' );
            let option = document.createElement( 'option' );
            $( option ).text( name );
            $( option ).val( name );
            sel.append( option );
        } );

        $( '#remove-file' ).on( 'click', ( ev ) =>{
            let filename = $( '#sel-file' ).val();
            this.db.ccfile.bulkDelete( [filename] );
        } );

        $( '#btn-cc-send' ).on( 'click', ( ev ) =>{
            this.sendLine();
        } );

        // ファイルのD&D
        $( window ).on( 'dragenter', ( ev ) =>{
            ev.preventDefault();
        } );
        $( window ).on( 'dragover', ( ev ) =>{
            ev.preventDefault();
        } );
        $( window ).on( 'drop', ( ev ) =>{
            ev.preventDefault();
            this.dropFile( ev.originalEvent );
        } );

    }
};


$( window ).on( 'load', ( ev ) =>{
    ContinuousComment.init();
} );
